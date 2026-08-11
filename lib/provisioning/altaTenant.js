/**
 * lib/provisioning/altaTenant.js — dar de alta un cliente nuevo, entero.
 *
 * (Fichero nuevo en /lib, regla #2: lo usa el endpoint de alta y cualquier
 * script futuro que quiera el mismo camino.)
 *
 * QUÉ RESUELVE: cada cliente nuevo costaba horas — clonar un seed de 400
 * líneas, correr un script por cada módulo, otro para la marca, otro para
 * poner el schema al día. Esto lo deja en un formulario.
 *
 * QUÉ HACE, en orden:
 *   1. Valida el slug (es el nombre del schema en PostgreSQL: irreversible).
 *   2. Crea la fila en master.tenants con marca y datos fiscales.
 *   3. Crea el schema crm_{slug} y TODAS sus tablas desde los modelos.
 *   4. Activa los módulos elegidos (con sus dependencias resueltas).
 *   5. Crea el usuario administrador con contraseña aleatoria.
 *   6. Guarda los datos fiscales para su facturación.
 *
 * NO hace: personalizaciones a medida. Un módulo propio de un cliente se sigue
 * programando de cero, como hasta ahora.
 */

import bcrypt from "bcrypt";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { Sequelize } from "sequelize";
import { getMasterModels } from "../db/masterDb.js";
import { getTenantDb } from "../db/tenantDb.js";
import { validarSeleccion, fraseDeExigencia } from "./dependencias.js";
import { moduloPorClave } from "./catalogo.js";
import { generatePassword, normalizeUsername } from "../team/access.js";
import { esSlugReservado } from "../tenant/slugsReservados.js";

/** El slug ES el nombre del schema: solo minúsculas, números y guión bajo. */
const SLUG_RE = /^[a-z][a-z0-9_]{2,40}$/;

// Reservados: schemas del sistema, convenciones del CRM y subdominios de
// infraestructura. La lista vive en lib/tenant/slugsReservados.js porque la
// comparten el alta y el resolutor de tenants — ver allí el motivo.

export function validarSlug(slug) {
  const s = String(slug || "").trim().toLowerCase();
  if (!SLUG_RE.test(s)) {
    return { error: "El identificador debe empezar por letra y llevar solo minúsculas, números y guión bajo (3-41 caracteres)." };
  }
  if (esSlugReservado(s)) return { error: `"${s}" está reservado, elige otro identificador.` };
  return { slug: s };
}

/** Sugerencia de identificador a partir del nombre comercial. */
export function slugDesdeNombre(nombre) {
  return String(nombre || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 41);
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const colorValido = (v) => (typeof v === "string" && HEX_RE.test(v.trim()) ? v.trim() : null);

/**
 * Pone el schema al día con las migraciones de sus módulos.
 *
 * POR QUÉ HACE FALTA (arreglado 2026-07-28): `sequelize.sync()` crea las tablas
 * desde los modelos, pero NO ejecuta ninguna migración, y en las migraciones no
 * solo hay columnas: hay índices en SQL crudo y FILAS SEMILLA. La que muerde de
 * verdad es `migrate-billing-rework`, que inserta las series 'F' y 'R' en
 * invoice_series. Sin ellas un cliente nuevo con Facturación podía crear
 * borradores pero al pulsar «Emitir» se llevaba un 500 crudo
 * (generateInvoiceNumber busca code='F' y no lo encuentra), y la pantalla de
 * series es de SOLO LECTURA: no había forma de desbloquearse desde la UI.
 * Era el único sitio del CRM que activaba módulos sin pasar por el disparador
 * (scripts/enable-module.js sí lo llamaba).
 *
 * `spawn` asíncrono, NUNCA `spawnSync`: son ~40 migraciones y el CRM entero
 * corre en UN solo contenedor Node — bloquear el bucle de eventos un minuto
 * dejaría tirados a todos los demás clientes mientras se da un alta.
 *
 * Nunca lanza: si falla, el alta ya está hecha y se informa de qué hay que
 * correr a mano.
 */
export function ponerSchemaAlDia(slug, modulos) {
  return new Promise((resolve) => {
    const guion = join(process.cwd(), "scripts", "ensure-tenant-schema.js");
    const args = [guion, slug];
    for (const m of modulos) args.push("--module", m);

    let hijo;
    try {
      hijo = spawn(process.execPath, args, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      return resolve({ ok: false, motivo: err.message });
    }

    let salida = "";
    hijo.stdout.on("data", (d) => { salida += d.toString(); });
    hijo.stderr.on("data", (d) => { salida += d.toString(); });

    const corte = setTimeout(() => { try { hijo.kill(); } catch { /* ya murió */ } }, 180_000);

    hijo.on("error", (err) => { clearTimeout(corte); resolve({ ok: false, motivo: err.message }); });
    hijo.on("close", (code) => {
      clearTimeout(corte);
      if (code === 0) return resolve({ ok: true });
      process.stderr.write(`[provisioning] migraciones de ${slug} (código ${code}):\n${salida.slice(-4000)}\n`);

      /*
       * QUÉ falló y CUÁNTAS, no «no se pudieron aplicar» (11/08/2026).
       *
       * El disparador sale con código 1 si falla UNA de cincuenta y cinco, y el
       * aviso de antes lo contaba como si no se hubiera aplicado ninguna. En la
       * prueba del 11/08 el cliente con Facturación tenía sus series F y R bien
       * sembradas —o sea que las migraciones de billing SÍ corrieron— y aun así
       * se anunció como roto. Eso lleva a repetir a mano un trabajo ya hecho, o
       * peor, a desconfiar de un cliente que está bien.
       */
      const resumen = /✗\s*(\d+)\s+de\s+(\d+)\s+fallaron:\s*(.+)/.exec(salida);
      const motivo = resumen
        ? `fallaron ${resumen[1]} de ${resumen[2]} migraciones (${resumen[3].trim()}); las demás sí se aplicaron`
        : `el disparador de migraciones terminó con código ${code}`;
      resolve({ ok: false, motivo });
    });
  });
}

/**
 * Crea el cliente completo. Devuelve { ok, slug, adminEmail, password, modulos }
 * o { error, status }.
 *
 * OJO: no hay transacción posible — se tocan master, el catálogo de schemas de
 * PostgreSQL y el schema nuevo. Por eso el orden va de lo más reversible a lo
 * menos, y si algo falla a mitad se informa de QUÉ quedó hecho para poder
 * repetir o limpiar a mano.
 */
export async function altaTenant({
  nombre,
  slug: slugCrudo,
  modulos = [],
  adminEmail,
  brand = {},
  fiscal = {},
  plan = "starter",
}) {
  const nombreLimpio = String(nombre || "").trim();
  if (!nombreLimpio) return { error: "El nombre del cliente es obligatorio", status: 422 };

  const v = validarSlug(slugCrudo || slugDesdeNombre(nombreLimpio));
  if (v.error) return { error: v.error, status: 422 };
  const slug = v.slug;

  // Las dependencias mandan y no se arreglan solas. El servidor lo comprueba
  // aunque la pantalla ya lo impida: quien llame por su cuenta a este endpoint
  // tampoco puede crear un cliente con un módulo que no va a funcionarle.
  const { modulos: seleccion, problemas } = validarSeleccion(modulos);
  if (problemas.length) {
    const nombreDe = (k) => moduloPorClave(k)?.nombre ?? k;
    return { error: problemas.map((p) => fraseDeExigencia(p, nombreDe)).join(" "), status: 422 };
  }
  if (!seleccion.length) return { error: "Elige al menos un módulo", status: 422 };

  const { Tenant, User, TenantModule } = getMasterModels();

  if (await Tenant.findOne({ where: { slug }, attributes: ["id"] })) {
    return { error: `Ya existe un cliente con el identificador "${slug}"`, status: 409 };
  }

  // Login del administrador. Si no dan email, se genera admin_{slug}.
  const norm = normalizeUsername(adminEmail || `admin_${slug}`, slug);
  if (norm.error) return { error: norm.error, status: 422 };
  const login = norm.username;
  if (await User.findOne({ where: { email: login }, attributes: ["id"] })) {
    return { error: `El usuario "${login}" ya existe. Elige otro correo de administrador.`, status: 409 };
  }

  const hechos = [];
  // Cosas que salieron mal pero NO abortan el alta: el operador tiene que
  // verlas en pantalla, no enterrarse en un log.
  const avisos = [];

  // ── 1. Tenant en master ────────────────────────────────────────────────────
  const settings = {};
  const primary = colorValido(brand.primaryColor);
  const secondary = colorValido(brand.secondaryColor);
  const logoUrl = typeof brand.logoUrl === "string" && brand.logoUrl.trim() ? brand.logoUrl.trim().slice(0, 500) : null;
  if (primary || secondary || logoUrl) {
    settings.brand = { ...(primary ? { primaryColor: primary } : {}), ...(secondary ? { secondaryColor: secondary } : {}), ...(logoUrl ? { logoUrl } : {}) };
  }

  const tenant = await Tenant.create({
    name: nombreLimpio,
    slug,
    dbName: "salamandra",
    plan,
    status: "active",
    settings,
  });
  hechos.push("cliente creado");

  try {
    // ── 2. Schema + todas las tablas desde los modelos ───────────────────────
    const raw = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
    await raw.query(`CREATE SCHEMA IF NOT EXISTS "crm_${slug}"`);
    await raw.close();
    hechos.push("schema creado");

    const { sequelize } = getTenantDb(slug);
    await sequelize.sync({ force: false });
    hechos.push("tablas creadas");

    // ── 3. Módulos ───────────────────────────────────────────────────────────
    for (const moduleKey of seleccion) {
      await TenantModule.create({ tenantId: tenant.id, moduleKey, enabled: true, version: 1 });
    }
    hechos.push(`${seleccion.length} módulos activados`);

    // ── 3b. Migraciones de esos módulos (índices y filas semilla) ────────────
    const migraciones = await ponerSchemaAlDia(slug, seleccion);
    if (migraciones.ok) {
      hechos.push("schema al día");
    } else {
      // No se aborta: el cliente ya existe y casi todo funciona. Pero hay que
      // decirlo alto, porque Facturación no podrá emitir hasta arreglarlo.
      avisos.push(
        `No se pudieron aplicar las migraciones (${migraciones.motivo}). Ejecuta en el servidor: ` +
          `docker exec crm-salamandra-app-1 node scripts/ensure-tenant-schema.js ${slug}`
      );
    }

    // ── 4. Administrador ─────────────────────────────────────────────────────
    const password = generatePassword();
    const passwordHash = await bcrypt.hash(password, 12);
    // validate:false: el login puede ser un nombre de usuario sin @, decisión
    // de producto ya establecida (patrón de las terapeutas de Aumenta).
    await User.create(
      { email: login, passwordHash, role: "admin", tenantId: tenant.id, moduleAccess: ["all"] },
      { validate: false }
    );
    hechos.push("administrador creado");

    // ── 5. Datos fiscales para su facturación ────────────────────────────────
    let fiscalGuardado = false;
    if (seleccion.includes("billing") && Object.values(fiscal).some((x) => x)) {
      try {
        const { models } = getTenantDb(slug);
        if (models.TenantBillingSettings) {
          await models.TenantBillingSettings.create({
            fiscalName: fiscal.fiscalName || nombreLimpio,
            taxId: fiscal.taxId || null,
            fiscalAddress: fiscal.address || null,
            fiscalCity: fiscal.city || null,
            fiscalZip: fiscal.zip || null,
            fiscalCountry: fiscal.country || "ES",
          });
          fiscalGuardado = true;
          hechos.push("datos fiscales guardados");
        }
      } catch (err) {
        // No es crítico: se pueden rellenar luego en Configuración.
        process.stderr.write(`[provisioning] datos fiscales: ${err.message}\n`);
        avisos.push("No se pudieron guardar los datos fiscales: rellénalos en Configuración → Facturación.");
      }
    }

    return { ok: true, slug, tenantId: tenant.id, adminEmail: login, password, modulos: seleccion, fiscalGuardado, hechos, avisos };
  } catch (err) {
    /*
     * ── EL ALTA A MEDIAS SE APARTA, NO SE BORRA (11/08/2026) ─────────────────
     *
     * Sigue en pie que borrar el schema solo es demasiado peligroso: los datos
     * que hubiera entrado se quedan y los mira una persona. Lo que NO puede
     * quedarse es el `status: 'active'`.
     *
     * Por qué: media docena de migraciones enumeran «los tenants activos» para
     * decidir sobre qué schemas actúan. Un cliente activo cuyo schema no llegó
     * a crearse las hace fallar A TODAS — o sea que un alta fallida rompe
     * TODAS las altas siguientes, y también cualquier migración que se lance a
     * mano. Se vio en local el 11/08: seis de siete altas de prueba salieron
     * con las migraciones sin aplicar por culpa de un único tenant sin schema.
     *
     * Suspendido, el resolutor de tenants no lo carga, no aparece en el
     * back-office y las migraciones lo saltan. Sigue estando entero en la base
     * para poder mirarlo, y reactivarlo es un clic si resulta que se puede
     * aprovechar.
     */
    // `tenant` se crea en la línea 193, FUERA de este try: aquí la fila existe
    // siempre. Lo único que puede fallar es el UPDATE, y si falla hay que
    // decirlo alto, porque un activo sin schema rompe las altas siguientes.
    let apartado = false;
    try {
      await tenant.update({ status: "suspended" });
      apartado = true;
    } catch (err2) {
      process.stderr.write(`[provisioning] no se pudo suspender el alta fallida de ${slug}: ${err2.message}\n`);
    }

    return {
      error:
        `El alta falló a mitad (${err.message}). Completado: ${hechos.join(", ") || "nada"}. ` +
        (apartado
          ? `El cliente "${slug}" queda SUSPENDIDO para que no afecte a las altas siguientes: revísalo y reactívalo o dale de baja.`
          : `⚠️ Además no se ha podido suspender: el cliente "${slug}" se queda ACTIVO y sin schema, y eso hará fallar las próximas altas. Suspéndelo a mano cuanto antes.`),
      status: 500,
      hechos,
      slug,
      suspendido: apartado,
    };
  }
}
