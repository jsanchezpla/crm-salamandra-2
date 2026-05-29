import { getMasterModels } from "../db/masterDb.js";
import { getTenantDb } from "../db/tenantDb.js";
import { cacheGet, cacheSet } from "./tenantCache.js";
import { handleRouteError } from "../utils/errors.js";
import { notFound } from "../utils/apiResponse.js";

/**
 * Resolución de tenant para endpoints públicos `/api/public/c/[tenantSlug]/*`.
 *
 * A diferencia de `getTenantContext` (que resuelve por JWT/header/subdominio),
 * este helper recibe el slug por parámetro de ruta — es lo que la landing
 * pública necesita.
 *
 * Reusa la misma estructura de `tenantContext` para que las rutas públicas
 * llamen a `hasModule`, `tenantModels`, etc. exactamente igual que las
 * privadas. Comparte el cache TTL con `tenantResolver.js` (clave `tenant:{slug}`).
 */

const DEFAULT_BRAND = {
  primaryColor: "#4F46E5",
  secondaryColor: "#0F0F0F",
  logoUrl: null,
};

const SLUG_RE = /^[a-z0-9_]+$/;

async function loadTenantConfig(slug) {
  const { Tenant, TenantModule } = getMasterModels();

  const tenant = await Tenant.findOne({ where: { slug, status: "active" } });
  if (!tenant) return null;

  const modules = await TenantModule.findAll({ where: { tenantId: tenant.id } });
  return { tenant: tenant.toJSON(), modules: modules.map((m) => m.toJSON()) };
}

function buildContext(slug, tenant, modules, tenantModels, tenantSequelize) {
  const moduleMap = new Map(modules.map((m) => [m.moduleKey, m]));

  return {
    slug,
    tenant,
    brand: { ...DEFAULT_BRAND, ...(tenant.settings?.brand || {}) },
    tenantModels,
    tenantSequelize,

    hasModule(moduleKey) {
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

/**
 * Lanza Error("TENANT_NOT_FOUND") si el slug no resuelve a un tenant activo.
 * Lanza Error("INVALID_SLUG") si el formato es inválido.
 */
export async function getPublicTenantContext(slug) {
  if (!slug || typeof slug !== "string" || !SLUG_RE.test(slug)) {
    const err = new Error("INVALID_SLUG");
    err.code = "INVALID_SLUG";
    throw err;
  }

  const cacheKey = `tenant:${slug}`;
  let config = cacheGet(cacheKey);

  if (!config) {
    config = await loadTenantConfig(slug);
    if (!config) {
      const err = new Error("TENANT_NOT_FOUND");
      err.code = "TENANT_NOT_FOUND";
      throw err;
    }
    cacheSet(cacheKey, config);
  }

  const { sequelize: tenantSequelize, models: tenantModels } = getTenantDb(slug);
  return buildContext(slug, config.tenant, config.modules, tenantModels, tenantSequelize);
}

/**
 * Wrapper para Route Handlers públicos.
 *
 * Lee `tenantSlug` desde `params` (Next.js dynamic segment) y construye el
 * `tenantContext`. Si el tenant no existe o el slug es inválido devuelve 404
 * con el mismo formato que el resto de la API.
 *
 * Uso:
 *   export const GET = withPublicTenant(async (request, routeContext, tenantContext) => {
 *     const { tenantModels, hasModule } = tenantContext;
 *     ...
 *   });
 */
export function withPublicTenant(handler) {
  return async function (request, routeContext) {
    try {
      const params = await routeContext?.params;
      const slug = params?.tenantSlug;
      const tenantContext = await getPublicTenantContext(slug);
      return await handler(request, routeContext, tenantContext);
    } catch (err) {
      if (err?.code === "INVALID_SLUG" || err?.code === "TENANT_NOT_FOUND") {
        return notFound("Tenant no encontrado");
      }
      return handleRouteError(err);
    }
  };
}
