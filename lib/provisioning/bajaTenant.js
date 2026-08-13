/**
 * lib/provisioning/bajaTenant.js — dar de baja a un cliente, entero y de una vez.
 *
 * (Fichero nuevo en /lib, regla #2: esto vivía suelto dentro de
 * `scripts/borrar-tenant.js` y por eso no se podía poner detrás de un botón. Lo
 * comparten ahora el script y el back-office, que es lo que obliga a que el
 * arreglo sea el mismo para los dos.)
 *
 * ── LA IDEA NO CAMBIA: APARTAR, NO DESTRUIR ─────────────────────────────────
 * El schema NO se borra: se RENOMBRA a `zzz_baja_<slug>_<fecha>`. En un segundo
 * queda fuera de todo —nadie enumera schemas con ese prefijo, el resolutor de
 * tenants no lo encuentra, las migraciones no lo ven— y sigue estando entero por
 * si mañana resulta que había algo dentro. Eso convierte una operación peligrosa
 * en una reversible, y es lo que permite que exista el botón.
 *
 * Destruir de verdad es un SEGUNDO acto, deliberado y aparte, y **sigue siendo
 * SSH**: `scripts/borrar-tenant.js <slug> --purgar`. No hay botón para eso ni lo
 * va a haber. `cicloVida.js` lo dice desde el principio y sigue teniendo razón:
 * un botón que borra los datos de un cliente es un accidente esperando su turno.
 *
 * ── QUÉ MANDA SOBRE LA RETENCIÓN (la pregunta que faltaba responder) ────────
 * Las facturas tienen obligación legal de conservarse años y los registros de
 * auditoría no se borran nunca (regla del proyecto). APARTAR convive con las dos
 * cosas y por eso puede ser un botón:
 *   · el schema sigue entero, con sus `invoices` dentro;
 *   · `master.audit_logs` no se toca — sus FK a tenant y usuario son ON DELETE
 *     SET NULL, así que los DELETE de aquí les vacían la atribución, y el
 *     `.rollback.sql` guarda a quién pertenecía cada línea para poder
 *     devolvérsela. El CONTENIDO de un registro de auditoría no se modifica
 *     nunca, que es lo que prohíbe la regla;
 *   · los papeles del cliente se apartan, no se borran.
 * PURGAR no convive con nada de eso: destruye las facturas. Por eso es el que se
 * queda en una terminal, donde quien lo escribe está mirando lo que destruye.
 *
 * ── LOS CUATRO ARREGLOS QUE HACÍAN FALTA PARA EL BOTÓN (13/08/2026) ─────────
 * 1. ES ATÓMICO. El `ALTER SCHEMA` y los tres `DELETE` iban sueltos: si el
 *    proceso moría en medio quedaba una fila de tenant sin schema, que es justo
 *    lo que `altaTenant.js` describe como veneno para TODAS las altas
 *    siguientes. Ahora van en una transacción (el DDL de PostgreSQL es
 *    transaccional): o se aparta entero, o no se aparta.
 * 2. AVISA A LA APP. Corriendo en otro proceso no se podía invalidar la caché de
 *    tenants, así que durante hasta 60 s el CRM seguía resolviendo a un cliente
 *    cuyo schema ya no se llamaba así. Desde el endpoint sí se puede, y además
 *    se suelta su conexión del pool.
 * 3. SE LLEVA LOS FICHEROS. El script no tocaba `uploads/` en ninguna línea:
 *    apartar el schema dejaba en disco los papeles del cliente, documentos de
 *    salud incluidos. Ahora se apartan igual que el schema
 *    (lib/provisioning/ficherosTenant.js).
 * 4. EL `.rollback.sql` CADUCA. Lleva dentro los `password_hash` de sus usuarios
 *    —hashes de bcrypt, no contraseñas, pero material para atacar offline— con
 *    permisos 600 sobre un volumen que nadie mira. Los poda
 *    `scripts/podar-bajas.js`.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { getMasterDb } from "../db/masterDb.js";
import { closeTenantConnection } from "../db/tenantDb.js";
import { invalidateTenantCache } from "../tenant/tenantResolver.js";
import {
  medirFicherosDelTenant,
  apartarFicherosDelTenant,
  listarApartados,
  purgarFicherosApartados,
} from "./ficherosTenant.js";

/** Nuestro propio tenant: sin él no hay back-office. */
export const NOSOTROS = "salamandra_solutions";
/** Prefijo de los schemas apartados. Nadie los enumera. */
export const APARTADO = "zzz_baja_";

const SLUG_RE = /^[a-z][a-z0-9_]{2,40}$/;

export function selloDeAhora(fecha = new Date()) {
  return fecha.toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

/** Dónde se guarda la red de rescate. Ver el bloque de `escribirRed`. */
export function carpetaDeBajas() {
  if (process.env.BAJA_BACKUPS_DIR) return process.env.BAJA_BACKUPS_DIR;
  if (existsSync("/app/uploads")) return "/app/uploads/_bajas";
  return join(process.cwd(), "uploads", "_bajas");
}

/* ══════════════════════════════════════════════════════════════════════════
 * MIRAR: qué se va a apartar
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Todo lo que hay que enseñar ANTES de que nadie confirme una baja. Solo lee.
 *
 * ⚠️ Las filas se cuentan de TODAS las tablas del schema, no de una lista
 * escrita a mano. Había una lista de trece tablas «interesantes» y mentía:
 * Retorika tiene sus datos en `quiz_attempts` (526 filas en producción) y
 * `training_users`, que no estaban en ella. El script anunciaba «DATOS DENTRO:
 * ninguno», el freno no saltaba y la baja pasaba sola. Es el peor fallo posible
 * en un freno: decir que no hay nada justo cuando alguien decide.
 */
export async function radiografiaParaBaja(slug) {
  if (!SLUG_RE.test(String(slug || ""))) return { error: `"${slug}" no es un identificador válido.` };

  const s = getMasterDb();
  const q = (sql, replacements) => s.query(sql, { replacements });

  const [[t]] = await q(
    `SELECT id, slug, name, plan, status, settings, created_at FROM master.tenants WHERE slug = :slug`,
    { slug }
  ).then(([r]) => [r]);
  if (!t) return { error: `No existe ningún cliente con el identificador "${slug}".` };

  const schema = `crm_${slug}`;
  const [[tablas]] = await q(
    `SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = :schema`,
    { schema }
  ).then(([r]) => [r]);
  const [usuarios] = await q(
    `SELECT id, email, role FROM master.users WHERE tenant_id = :id ORDER BY email`,
    { id: t.id }
  );
  const [modulos] = await q(
    `SELECT module_key, enabled FROM master.tenant_modules WHERE tenant_id = :id ORDER BY module_key`,
    { id: t.id }
  );

  // A `pg_catalog` y no a `information_schema.tables`: Sequelize reconoce las
  // consultas a esa vista como «listar tablas» y devuelve un array plano de
  // cadenas en vez de filas, así que `row.table_name` salía undefined y la
  // consulta siguiente iba contra `crm_x.undefined`. Lo cazó la prueba.
  const [tablasDelSchema] = await q(
    `SELECT c.relname AS tabla
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = :schema AND c.relkind = 'r'
      ORDER BY 1`,
    { schema }
  );
  const conDatos = [];
  for (const { tabla } of tablasDelSchema) {
    const [[c]] = await q(`SELECT count(*)::int n FROM "${schema}"."${tabla}"`).then(([r]) => [r]);
    if (c.n > 0) conDatos.push({ tabla, n: c.n });
  }
  conDatos.sort((a, b) => b.n - a.n);

  const ficheros = await medirFicherosDelTenant(slug);

  return {
    tenant: {
      id: t.id, slug: t.slug, nombre: t.name, plan: t.plan,
      estado: t.status, alta: t.created_at, settings: t.settings,
    },
    schema,
    tablas: tablas.n,
    usuarios: usuarios.map((u) => ({ id: u.id, email: u.email, rol: u.role })),
    modulos: modulos.map((m) => m.module_key),
    conDatos,
    filasTotales: conDatos.reduce((n, x) => n + x.n, 0),
    ficheros,
    esNosotros: slug === NOSOTROS,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * LA RED: cómo devolver las filas de master
 * ════════════════════════════════════════════════════════════════════════ */

const esc = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const json = (v) => (v === null || v === undefined ? "NULL" : `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`);

async function construirRed({ slug, schema, destino, tenant, carpetaFicheros }) {
  const s = getMasterDb();
  const q = (sql, replacements) => s.query(sql, { replacements });

  const [usuarios] = await q(
    `SELECT id, email, password_hash, role, tenant_id, module_access, created_at
       FROM master.users WHERE tenant_id = :id ORDER BY email`,
    { id: tenant.id }
  );
  // El `id` va incluido a propósito: `master.tenant_modules.id` es NOT NULL y no
  // tiene valor por defecto en la base, así que un rollback que no lo traiga
  // falla con 23502 justo el día que hace falta. Lo descubrió la prueba de ida y
  // vuelta del 11/08, no un incidente.
  const [modulos] = await q(
    `SELECT id, module_key, enabled, version, schema_extensions, logic_overrides, ui_override, feature_flags
       FROM master.tenant_modules WHERE tenant_id = :id ORDER BY module_key`,
    { id: tenant.id }
  );

  const lineas = [
    `-- Vuelta atrás de la baja de "${slug}" (${new Date().toISOString()}).`,
    `-- Devuelve las filas de master y el schema:  psql < este_fichero`,
    `--`,
    `-- ⚠️ LLEVA DENTRO LOS password_hash DE SUS USUARIOS. Son hashes de bcrypt, no`,
    `--    contraseñas, pero se atacan offline: este fichero es 0600 y lo caduca`,
    `--    scripts/podar-bajas.js. No lo copies fuera de aquí.`,
    ...(carpetaFicheros
      ? [
          `--`,
          `-- ⚠️ SUS FICHEROS NO VUELVEN CON ESTO. Están apartados en:`,
          `--      ${carpetaFicheros}`,
          `--    Hay que devolver esas carpetas a uploads/ a mano.`,
        ]
      : []),
    ``,
    // Sin esto, `psql < fichero` sigue adelante tras un error y deja una
    // restauración A MEDIAS con pinta de correcta: fue exactamente lo que pasó
    // con las comillas de `version`. Si algo falla, que se pare y se vea.
    `\\set ON_ERROR_STOP on`,
    `BEGIN;`,
    ``,
    `ALTER SCHEMA "${destino}" RENAME TO "${schema}";`,
    ``,
    `INSERT INTO master.tenants (id, name, slug, db_name, plan, status, settings, created_at, updated_at)`,
    `VALUES (${esc(tenant.id)}, ${esc(tenant.nombre)}, ${esc(tenant.slug)}, 'salamandra', ${esc(tenant.plan)}, ${esc(tenant.estado)}, ${json(tenant.settings)}, ${esc(tenant.alta?.toISOString?.() ?? tenant.alta)}, now());`,
    ``,
  ];

  for (const u of usuarios) {
    lineas.push(
      `INSERT INTO master.users (id, email, password_hash, role, tenant_id, module_access, created_at, updated_at)`,
      `VALUES (${esc(u.id)}, ${esc(u.email)}, ${esc(u.password_hash)}, ${esc(u.role)}, ${esc(u.tenant_id)}, ${json(u.module_access)}, ${esc(u.created_at?.toISOString?.() ?? u.created_at)}, now());`
    );
  }
  lineas.push("");
  for (const m of modulos) {
    lineas.push(
      `INSERT INTO master.tenant_modules (id, tenant_id, module_key, enabled, version, schema_extensions, logic_overrides, ui_override, feature_flags, created_at, updated_at)`,
      // `version` va por `esc()` como todo lo demás: en la base es VARCHAR y su
      // valor real es '1.0.0', así que interpolarlo a pelo generaba
      // `VALUES (..., 1.0.0, ...)`, un error de sintaxis (42601). Y `psql` no
      // para en el primer fallo: entraban el tenant y los usuarios y solo
      // reventaban los módulos, uno a uno. El cliente volvía sin un solo módulo
      // —sidebar vacío, 403 en todo— con apariencia de restauración correcta.
      `VALUES (${esc(m.id)}, ${esc(tenant.id)}, ${esc(m.module_key)}, ${m.enabled}, ${esc(m.version)}, ${json(m.schema_extensions)}, ${json(m.logic_overrides)}, ${esc(m.ui_override)}, ${json(m.feature_flags)}, now(), now());`
    );
  }

  /* ── La auditoría: devolver de quién era cada línea ──────────────────────
   * `master.audit_logs` apunta a tenants y a users con FK ON DELETE SET NULL.
   * O sea que los tres DELETE de la baja, sin tocar la tabla de auditoría, le
   * vacían el `tenant_id` y el `user_id` a TODO el historial del cliente. Y eso
   * no lo devolvía nada: el rollback traía de vuelta al tenant y a sus usuarios
   * con los mismos UUID, pero las líneas de auditoría se quedaban a NULL para
   * siempre, sin ninguna columna de la que deducir de quién eran. Deshacer la
   * baja de Aumenta le habría dejado Equipo → Actividad en blanco.
   *
   * Aquí NO se modifica el contenido de ningún registro de auditoría —eso sí lo
   * prohíbe la regla del proyecto—: se guarda a quién pertenecía cada uno para
   * poder devolverle la atribución que el SET NULL le quita. */
  const [rastro] = await q(
    `SELECT id, tenant_id, user_id FROM master.audit_logs
      WHERE tenant_id = :id OR user_id IN (SELECT id FROM master.users WHERE tenant_id = :id)`,
    { id: tenant.id }
  );
  if (rastro.length) {
    // Se agrupa por el par (tenant_id, user_id) —que son un puñado: el tenant y
    // sus usuarios— y se emite un UPDATE por grupo, troceado, en vez de una
    // sentencia por fila. Con años de auditoría eso es la diferencia entre un
    // fichero manejable y uno de cientos de miles de líneas.
    const grupos = new Map();
    for (const r of rastro) {
      const clave = `${r.tenant_id ?? ""}|${r.user_id ?? ""}`;
      if (!grupos.has(clave)) grupos.set(clave, { tid: r.tenant_id, uid: r.user_id, ids: [] });
      grupos.get(clave).ids.push(r.id);
    }
    lineas.push("", `-- Atribución de ${rastro.length} líneas de auditoría (el DELETE las deja a NULL).`);
    for (const g of grupos.values()) {
      for (let i = 0; i < g.ids.length; i += 500) {
        const trozo = g.ids.slice(i, i + 500).map(esc).join(", ");
        lineas.push(
          `UPDATE master.audit_logs SET tenant_id = ${esc(g.tid)}, user_id = ${esc(g.uid)} WHERE id IN (${trozo});`
        );
      }
    }
  }

  lineas.push("", "COMMIT;");
  return { texto: `${lineas.join("\n")}\n`, usuarios: usuarios.length, modulos: modulos.length };
}

/**
 * Escribe la red ANTES de tocar nada. Si no hay red, no se salta.
 *
 * ── DÓNDE (11/08/2026, encontrado en producción) ────────────────────────────
 * Esto era `process.cwd()/backups` y en el contenedor petaba con EACCES: el
 * proceso corre como `nextjs` y `/app` es de root, así que la baja documentada
 * para producción NO se podía ejecutar. Y aunque se hubiera podido, `/app` no
 * está montado: el `.rollback.sql` se habría ido con el siguiente `deploy.sh`.
 * Por eso el destino dentro del contenedor es la carpeta montada, que sobrevive
 * (comprobado el 12/08 con un deploy completo por encima).
 */
function escribirRed(slug, sello, texto) {
  const carpeta = carpetaDeBajas();
  try {
    mkdirSync(carpeta, { recursive: true });
  } catch (e) {
    return {
      error:
        `No se puede escribir la red de rescate en "${carpeta}" (${e.code ?? e.message}). ` +
        `No se ha tocado NADA: sin el .rollback.sql esta baja no es reversible. ` +
        `Indica una carpeta escribible con BAJA_BACKUPS_DIR=/ruta.`,
    };
  }
  const fichero = join(carpeta, `baja-${slug}-${sello}.rollback.sql`);
  // 0600: dentro van los `password_hash` de sus usuarios.
  writeFileSync(fichero, texto, { encoding: "utf8", mode: 0o600 });
  return { fichero };
}

/* ══════════════════════════════════════════════════════════════════════════
 * HACER: apartar al cliente
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * @param {object} opciones
 * @param {string} opciones.slug
 * @param {string} opciones.confirmo        hay que TECLEAR el slug
 * @param {boolean} [opciones.conDatos]     hace falta si el cliente tiene datos
 * @param {boolean} [opciones.permitirNosotros]
 * @returns {Promise<object>} `{ ok, ... }` o `{ error, status, ... }`
 */
export async function darDeBajaTenant({ slug, confirmo, conDatos = false, permitirNosotros = false }) {
  const rx = await radiografiaParaBaja(slug);
  if (rx.error) return { error: rx.error, status: 404 };

  // ── Los frenos, todos antes de tocar nada ────────────────────────────────
  if (rx.esNosotros && !permitirNosotros) {
    return {
      error:
        `"${NOSOTROS}" somos nosotros: es el único tenant con el módulo 'provisioning' y sin él no hay ` +
        `back-office (ni esta pantalla, ni el alta, ni el registro). Desde aquí no se puede.`,
      status: 409,
    };
  }
  if (confirmo !== slug) {
    return { error: `Para darlo de baja hay que teclear su identificador: ${slug}`, status: 428 };
  }
  if (rx.conDatos.length && !conDatos) {
    const resumen = rx.conDatos.slice(0, 5).map((x) => `${x.tabla}=${x.n}`).join(", ");
    return {
      error:
        `Este cliente TIENE DATOS: ${rx.filasTotales} filas en ${rx.conDatos.length} tablas (${resumen}…). ` +
        `Míralos antes y vuelve a enviarlo aceptándolo.`,
      status: 428,
      conDatos: rx.conDatos,
    };
  }

  const sello = selloDeAhora();
  const destino = `${APARTADO}${slug}_${sello}`;

  // ── 1. La red, antes que nada ────────────────────────────────────────────
  const carpetaFicheros = rx.ficheros.total.ficheros
    ? join(carpetaDeBajas(), `${slug}_${sello}`)
    : null;
  const red = await construirRed({
    slug, schema: rx.schema, destino, tenant: rx.tenant, carpetaFicheros,
  });
  const escrita = escribirRed(slug, sello, red.texto);
  if (escrita.error) return { error: escrita.error, status: 500 };

  // ── 2. Y ahora sí, de una vez o nada ─────────────────────────────────────
  // ATÓMICO (13/08/2026). El DDL de PostgreSQL es transaccional, así que el
  // renombrado y los tres DELETE viven o mueren juntos. Antes iban sueltos: si
  // el proceso moría en medio quedaba una fila de tenant sin schema, que es lo
  // que `altaTenant.js` describe como veneno para todas las altas siguientes.
  // La conexión de ese tenant se suelta ANTES del ALTER, no después: el
  // renombrado necesita un lock ACCESS EXCLUSIVE sobre el schema, y una
  // conexión viva del pool apuntando ahí puede hacerle esperar. Soltarla
  // después dejaba la baja a merced de una petición que estuviera a medias.
  await closeTenantConnection(slug);

  const s = getMasterDb();
  try {
    await s.transaction(async (t) => {
      const q = (sql, replacements) => s.query(sql, { transaction: t, replacements });
      if (rx.tablas > 0) await q(`ALTER SCHEMA "${rx.schema}" RENAME TO "${destino}"`);
      await q(`DELETE FROM master.tenant_modules WHERE tenant_id = :id`, { id: rx.tenant.id });
      await q(`DELETE FROM master.users WHERE tenant_id = :id`, { id: rx.tenant.id });
      await q(`DELETE FROM master.tenants WHERE id = :id`, { id: rx.tenant.id });
    });
  } catch (err) {
    return {
      error:
        `La baja se ha deshecho entera y el cliente sigue como estaba (${err.message}). ` +
        `La red de rescate escrita en ${escrita.fichero} sobra: bórrala.`,
      status: 500,
    };
  }

  // ── 3. Avisar a la app ───────────────────────────────────────────────────
  // Sin esto el CRM sigue hasta 60 s resolviendo a un cliente cuyo schema ya no
  // se llama así — y sirviendo 500 en vez de mandarlo al login. Y se vuelve a
  // soltar la conexión: entre el cierre de antes y el commit ha podido entrar
  // una petición suya que la reabriera.
  invalidateTenantCache(slug);
  await closeTenantConnection(slug);

  // ── 4. Los papeles ───────────────────────────────────────────────────────
  // DESPUÉS del commit, porque mover ficheros no se puede deshacer con un
  // ROLLBACK. Best-effort: lo que falle se devuelve y se enseña.
  const ficheros = rx.ficheros.total.ficheros
    ? await apartarFicherosDelTenant(slug, `${slug}_${sello}`)
    : { movidas: [], errores: [], carpeta: null };

  return {
    ok: true,
    slug,
    tenantId: rx.tenant.id,
    nombre: rx.tenant.nombre,
    schemaApartado: rx.tablas > 0 ? destino : null,
    rollback: escrita.fichero,
    usuarios: red.usuarios,
    modulos: red.modulos,
    filas: rx.filasTotales,
    tablasConDatos: rx.conDatos.length,
    ficheros: {
      movidos: ficheros.movidas.reduce((n, m) => n + m.ficheros, 0),
      carpeta: ficheros.carpeta,
      errores: ficheros.errores,
    },
    // Lo que hay que decirle a quien acaba de pulsar, sin adornos.
    avisos: [
      rx.tablas > 0
        ? `Su schema sigue entero en "${destino}". Deshacerlo es: psql < ${escrita.fichero}`
        : "No tenía schema que apartar.",
      ...(ficheros.errores.length
        ? [`⚠ No se han podido apartar todos sus ficheros: ${ficheros.errores.join("; ")}`]
        : []),
      "Eliminarlo del todo es el segundo acto, y es el que no tiene vuelta atrás.",
    ],
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * SEGUNDO ACTO: eliminar del todo lo ya apartado
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ ESTA ES LA PARTE QUE NO TIENE VUELTA ATRÁS.
 *
 * Estuvo a propósito solo en SSH hasta el 13/08/2026, cuando Rodrigo pidió
 * poder hacerlo también desde el panel. La decisión que había —«un botón que
 * borra los datos de un cliente es un accidente esperando su turno»— seguía
 * siendo buena, y lo que la hace compatible con un botón es que YA NO ES EL
 * PRIMER ACTO: aquí no se puede llegar sin haber dado de baja al cliente antes,
 * porque lo único que se puede eliminar es lo que ya está apartado. Un
 * accidente pide ahora dos accidentes seguidos, con dos confirmaciones tecleadas
 * y con el cliente fuera de servicio en medio.
 *
 * Los frenos, que aquí son más que en la baja:
 *   · hay que teclear el identificador, como en todo lo demás;
 *   · hay que reconocer A PROPÓSITO que se destruyen sus FACTURAS, que tienen
 *     obligación legal de conservarse años. Es la única casilla del back-office
 *     que existe para reconocer una consecuencia legal, y por eso no se puede
 *     dar por marcada desde el servidor;
 *   · se acota por SELLO, no por cliente: se elimina UNA baja concreta, no
 *     «todo lo de este cliente». Dos bajas del mismo slug no se van juntas.
 *
 * Lo que se lleva: el schema apartado, sus ficheros y su `.rollback.sql` —que
 * sin el schema ya no restaura nada y lo único que conserva son los
 * `password_hash` de sus usuarios—.
 *
 * Lo que NO se lleva, y no es un olvido: `master.audit_logs`. Los registros de
 * auditoría no se borran nunca (regla del proyecto). Las líneas de este cliente
 * siguen ahí, con su `tenant_id` a NULL desde la baja, y con esto pierden la
 * última forma de recuperar a quién pertenecían. Es el precio de eliminar.
 */
export async function eliminarBaja({ slug, sello, confirmo, entiendoQueSeDestruyenSusFacturas }) {
  if (!SLUG_RE.test(String(slug || ""))) return { error: `"${slug}" no es un identificador válido.`, status: 422 };
  if (!/^\d{14}$/.test(String(sello || ""))) return { error: "Falta la baja concreta que se elimina.", status: 422 };
  if (confirmo !== slug) {
    return { error: `Para eliminarlo hay que teclear su identificador: ${slug}`, status: 428 };
  }
  if (entiendoQueSeDestruyenSusFacturas !== true) {
    return {
      error:
        "Eliminar destruye sus facturas, que hay obligación legal de conservar años, y sus registros de auditoría se quedan sin dueño para siempre. Hay que reconocerlo a propósito.",
      status: 428,
    };
  }

  const schema = `${APARTADO}${slug}_${sello}`;
  const s = getMasterDb();

  // Existe, y es un apartado. El `startsWith` no sobra aunque el nombre se
  // construya aquí: es el último sitio antes de un DROP CASCADE.
  const [[hay]] = await s
    .query(`SELECT 1 AS x FROM information_schema.schemata WHERE schema_name = :schema`, {
      replacements: { schema },
    })
    .then(([r]) => [r]);

  const enDisco = await listarApartados(slug, sello);
  if (!hay && !enDisco.carpetas.length && !enDisco.redes.length) {
    return { error: "Esa baja ya no existe: no queda nada suyo que eliminar.", status: 404 };
  }

  let tablas = 0;
  if (hay) {
    if (!schema.startsWith(APARTADO)) return { error: "NEGADO", status: 500 };
    const [[t]] = await s
      .query(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = :schema`, {
        replacements: { schema },
      })
      .then(([r]) => [r]);
    tablas = t.n;
    await s.query(`DROP SCHEMA "${schema}" CASCADE`);
  }

  const { borradas, redes } = await purgarFicherosApartados(slug, sello);

  return {
    ok: true,
    slug,
    sello,
    schemaDestruido: hay ? schema : null,
    tablas,
    ficheros: borradas,
    redes,
  };
}

/**
 * Las cuentas cerradas que siguen apartadas, con lo que queda de cada una.
 *
 * Sale de las DOS fuentes a la vez —los schemas `zzz_baja_*` y lo que hay en
 * `uploads/_bajas/`— porque pueden ir por separado: una baja de un cliente sin
 * schema deja solo ficheros, y una purga a medias podía dejar solo la red. Si
 * esta pantalla mirara únicamente los schemas, lo demás no lo vería nadie.
 */
export async function listarBajas() {
  const s = getMasterDb();
  const [schemas] = await s.query(
    `SELECT n.nspname AS schema,
            (SELECT count(*)::int FROM information_schema.tables t WHERE t.table_schema = n.nspname) AS tablas
       FROM pg_namespace n
      WHERE n.nspname LIKE '${APARTADO}%'
      ORDER BY 1 DESC`
  );

  /** `zzz_baja_<slug>_<14 dígitos>` → { slug, sello }. */
  const partir = (nombre) => {
    const m = new RegExp(`^${APARTADO}([a-z][a-z0-9_]*)_(\\d{14})$`).exec(nombre);
    return m ? { slug: m[1], sello: m[2] } : null;
  };

  const bajas = new Map();
  for (const row of schemas) {
    const p = partir(row.schema);
    if (!p) continue;
    bajas.set(`${p.slug}_${p.sello}`, {
      slug: p.slug, sello: p.sello, schema: row.schema, tablas: row.tablas,
      ficheros: false, red: false,
    });
  }

  // Y lo que hay en disco, que puede sobrevivir a su schema y al revés.
  const raiz = carpetaDeBajas();
  let entradas = [];
  try {
    entradas = readdirSync(raiz, { withFileTypes: true });
  } catch {
    /* no hay carpeta de bajas todavía */
  }
  for (const e of entradas) {
    const m = /^([a-z][a-z0-9_]*)_(\d{14})$/.exec(e.name);
    const r = /^baja-([a-z][a-z0-9_]*)-(\d{14})\.rollback\.sql$/.exec(e.name);
    const hit = e.isDirectory() ? m : r;
    if (!hit) continue;
    const clave = `${hit[1]}_${hit[2]}`;
    if (!bajas.has(clave)) {
      bajas.set(clave, {
        slug: hit[1], sello: hit[2], schema: null, tablas: 0, ficheros: false, red: false,
      });
    }
    if (e.isDirectory()) bajas.get(clave).ficheros = true;
    else bajas.get(clave).red = true;
  }

  return [...bajas.values()]
    .map((b) => ({
      ...b,
      // El sello es AAAAMMDDHHMMSS en UTC: se devuelve como ISO para que la
      // pantalla lo pinte en hora local sin volver a partir la cadena.
      cuando: `${b.sello.slice(0, 4)}-${b.sello.slice(4, 6)}-${b.sello.slice(6, 8)}T${b.sello.slice(8, 10)}:${b.sello.slice(10, 12)}:${b.sello.slice(12, 14)}Z`,
    }))
    .sort((a, b) => b.sello.localeCompare(a.sello));
}
