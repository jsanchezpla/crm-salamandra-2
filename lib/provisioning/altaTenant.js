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
import { Sequelize } from "sequelize";
import { getMasterModels } from "../db/masterDb.js";
import { getTenantDb } from "../db/tenantDb.js";
import { resolverDependencias } from "./catalogo.js";
import { generatePassword, normalizeUsername } from "../team/access.js";

/** El slug ES el nombre del schema: solo minúsculas, números y guión bajo. */
const SLUG_RE = /^[a-z][a-z0-9_]{2,40}$/;

// Reservados: chocarían con schemas del sistema o con convenciones del CRM.
const SLUGS_PROHIBIDOS = new Set(["master", "public", "information_schema", "pg_catalog", "demo_golden", "crm"]);

export function validarSlug(slug) {
  const s = String(slug || "").trim().toLowerCase();
  if (!SLUG_RE.test(s)) {
    return { error: "El identificador debe empezar por letra y llevar solo minúsculas, números y guión bajo (3-41 caracteres)." };
  }
  if (SLUGS_PROHIBIDOS.has(s)) return { error: `"${s}" está reservado, elige otro identificador.` };
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

  const seleccion = resolverDependencias(modulos);
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
      }
    }

    return { ok: true, slug, tenantId: tenant.id, adminEmail: login, password, modulos: seleccion, fiscalGuardado, hechos };
  } catch (err) {
    // Se informa de hasta dónde llegó: el operador decide si repetir con otro
    // identificador o limpiar. Borrar automáticamente un schema es demasiado
    // peligroso para hacerlo sin que nadie lo pida.
    return {
      error: `El alta falló a mitad (${err.message}). Completado: ${hechos.join(", ") || "nada"}. Revisa el cliente "${slug}" antes de reintentar.`,
      status: 500,
      hechos,
    };
  }
}
