import { jwtVerify } from "jose";
import { getMasterModels } from "../db/masterDb.js";
import { getTenantDb } from "../db/tenantDb.js";
import { cacheGet, cacheSet, cacheInvalidate } from "./tenantCache.js";
import { esSlugReservado } from "./slugsReservados.js";
import { UnauthorizedError } from "../utils/errors.js";

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

// ─── Resolución del slug ────────────────────────────────────────────────────

function slugFromSubdomain(request) {
  const host = request.headers.get("host") || "";
  // Esperamos: {slug}.dominio.com — ignorar www y localhost
  const parts = host.split(".");
  if (parts.length >= 3 && parts[0] !== "www") {
    const etiqueta = parts[0].toLowerCase();
    // Un subdominio de INFRAESTRUCTURA no es la identidad de nadie. Sin este
    // filtro, admin.salamandrasolutions.com intentaría resolver un tenant
    // llamado "admin" — y bastaría con dar de alta un cliente con ese slug para
    // apoderarse del back-office. Ver lib/tenant/slugsReservados.js.
    if (esSlugReservado(etiqueta)) return null;
    return etiqueta;
  }
  return null;
}

function slugFromHeader(request) {
  const header = request.headers.get("x-tenant");
  return header ? header.toLowerCase() : null;
}

async function slugFromJwt(request) {
  try {
    const cookie = request.cookies?.get?.("access_token")?.value;
    if (!cookie) return null;
    const { payload } = await jwtVerify(cookie, JWT_SECRET);
    return payload.tenantSlug ? String(payload.tenantSlug).toLowerCase() : null;
  } catch {
    return null;
  }
}

// ─── Carga de config desde master ──────────────────────────────────────────

async function loadTenantConfig(slug) {
  const { Tenant, TenantModule } = getMasterModels();

  const tenant = await Tenant.findOne({
    where: { slug, status: "active" },
  });

  if (!tenant) return null;

  const modules = await TenantModule.findAll({
    where: { tenantId: tenant.id },
  });

  return { tenant: tenant.toJSON(), modules: modules.map((m) => m.toJSON()) };
}

// Carga el rol y moduleAccess del usuario para enforcement por API. NO se
// cachea (los cambios de ACL deben aplicar al instante). El sobrecoste es una
// query a master.users por request autenticada — comparable al login.
//
// FALLA EN CERRADO (2026-07-24): antes esto tragaba cualquier error devolviendo
// null, y null significa "petición sin usuario" → hasModule concedía TODOS los
// módulos del tenant. Es decir: un usuario BORRADO con token aún válido (TTL 15
// min) o un error transitorio de la BD master daban MÁS acceso, no menos. Ahora
// un error de BD se propaga (→ 500, sin datos) y "no existe" devuelve null para
// que getTenantContext lo convierta en 401.
async function loadUserAccess(userId) {
  if (!userId) return null;
  const { User } = getMasterModels();
  const user = await User.findByPk(userId, {
    attributes: ["id", "role", "moduleAccess"],
  });
  return user ? user.toJSON() : null;
}

// ─── Construcción del contexto ──────────────────────────────────────────────

const DEFAULT_BRAND = {
  primaryColor: "#4F46E5",
  secondaryColor: "#0F0F0F",
  logoUrl: null,
};

function buildContext(slug, tenant, modules, tenantModels, tenantSequelize, user) {
  const moduleMap = new Map(modules.map((m) => [m.moduleKey, m]));
  const userAccess = user && Array.isArray(user.moduleAccess) ? user.moduleAccess : null;
  const isUserWildcard = !!user && (user.role === "superadmin" || (userAccess?.includes("all") ?? false));

  return {
    slug,
    tenant,
    user,
    brand: { ...DEFAULT_BRAND, ...(tenant.settings?.brand || {}) },
    tenantModels,
    tenantSequelize,

    // Cross-check tenant + user. Cuando hay usuario autenticado (middleware
    // inyectó x-user-id), exigimos que su moduleAccess incluya la clave o
    // que tenga wildcard ("all" / superadmin). Sin usuario (webhooks, /api/public,
    // /api/external...) sólo se valida el tenant.
    hasModule(moduleKey) {
      const mod = moduleMap.get(moduleKey);
      if (!mod || !mod.enabled) return false;
      if (!user) return true;
      if (isUserWildcard) return true;
      return userAccess !== null && userAccess.includes(moduleKey);
    },

    // Variante sin enforcement de usuario, para casos donde un endpoint
    // autenticado necesita saber si el TENANT tiene un módulo activo (p.ej.
    // gates condicionales: "si el tenant tiene inventory, descontar stock").
    tenantHasModule(moduleKey) {
      const mod = moduleMap.get(moduleKey);
      return !!(mod && mod.enabled);
    },

    getLogicOverride(moduleKey, key) {
      const mod = moduleMap.get(moduleKey);
      if (!mod || !mod.logicOverrides) return null;
      return mod.logicOverrides[key] ?? null;
    },

    hasFeatureFlag(moduleKey, flagKey) {
      const mod = moduleMap.get(moduleKey);
      if (!mod || !mod.featureFlags) return false;
      return !!mod.featureFlags[flagKey];
    },
  };
}

// ─── API pública ────────────────────────────────────────────────────────────

/**
 * Slug del tenant al que apunta una request. Orden: JWT > header x-tenant >
 * subdominio.
 *
 * Se exporta (2026-07-26) porque la verificación HMAC de los webhooks necesita
 * saber a QUÉ tenant dice ir la petición ANTES de tocar la BD, para validar la
 * firma contra el secreto de ese tenant (ver lib/training/webhookAuth.js). Debe
 * ser exactamente la misma resolución que usa getTenantContext: si divergieran,
 * se podría firmar como un tenant y acabar escribiendo en otro.
 */
export async function resolveRequestSlug(request) {
  return (await slugFromJwt(request)) || slugFromHeader(request) || slugFromSubdomain(request);
}

export async function getTenantContext(request) {
  const slug = await resolveRequestSlug(request);

  if (!slug || !/^[a-z0-9_]+$/.test(slug)) {
    throw new Error("Tenant no identificado en la request");
  }

  const cacheKey = `tenant:${slug}`;
  let config = cacheGet(cacheKey);

  if (!config) {
    config = await loadTenantConfig(slug);
    if (!config) {
      throw new Error(`Tenant '${slug}' no encontrado o inactivo`);
    }
    cacheSet(cacheKey, config);
  }

  const userId = request.headers.get("x-user-id");
  const user = userId ? await loadUserAccess(userId) : null;
  // Petición AUTENTICADA (el middleware validó el JWT e inyectó x-user-id) cuyo
  // usuario ya no existe en master.users → 401, no "modo infraestructura". El
  // user=null permisivo queda reservado a peticiones SIN usuario (webhooks,
  // /api/public…), que es para lo que se diseñó.
  if (userId && !user) {
    throw new UnauthorizedError("Sesión no válida: el usuario ya no existe");
  }

  const { sequelize: tenantSequelize, models: tenantModels } = getTenantDb(slug);

  return buildContext(slug, config.tenant, config.modules, tenantModels, tenantSequelize, user);
}

export function invalidateTenantCache(slug) {
  cacheInvalidate(`tenant:${slug}`);
}
