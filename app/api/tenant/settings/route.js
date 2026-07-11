import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../lib/utils/apiResponse.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../../../../lib/utils/errors.js";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { invalidateTenantCache } from "../../../../lib/tenant/tenantResolver.js";

/**
 * /api/tenant/settings — configuración básica del tenant.
 *
 * Cubre: datos del tenant (nombre), marca (colores/logo) y las credenciales de
 * IA por-tenant (API keys de Anthropic y de Google). Estas dos claves viven en
 * `master.tenants.settings.integrations` y son SECRETOS: nunca se devuelven en
 * claro (solo un estado "configurada" + una pista enmascarada), y el layout del
 * dashboard las elimina del tenant antes de serializarlo al cliente.
 *
 * Escritura solo para admin. Tras guardar se invalida la caché de tenant para
 * que el análisis con IA vea la nueva key de inmediato (la caché dura ~60s).
 */

// Nunca exponer la clave entera. Solo si está puesta + una pista corta.
function keyStatus(key) {
  if (!key || typeof key !== "string") return { configured: false, hint: null };
  const hint = key.length > 12 ? `${key.slice(0, 6)}…${key.slice(-4)}` : "••••";
  return { configured: true, hint };
}

// Semántica de actualización de una clave:
//   undefined → no se toca (para poder guardar la marca sin perder la key)
//   null | "" → se borra
//   string    → se fija (trim)
function applyKey(target, field, value) {
  if (value === undefined) return;
  if (value === null || value === "") {
    delete target[field];
    return;
  }
  if (typeof value === "string" && value.trim()) target[field] = value.trim();
}

export const GET = withTenant(async (request, _routeContext, ctx) => {
  const t = ctx.tenant;
  const brand = t.settings?.brand ?? {};
  const integ = t.settings?.integrations ?? {};

  return ok({
    name: t.name,
    slug: t.slug,
    plan: t.plan,
    brand: {
      primaryColor: brand.primaryColor ?? null,
      secondaryColor: brand.secondaryColor ?? null,
      logoUrl: brand.logoUrl ?? null,
    },
    integrations: {
      anthropic: keyStatus(integ.anthropicApiKey),
      googlePlaces: keyStatus(integ.googlePlacesApiKey),
    },
  });
});

export const PATCH = withTenant(async (request, _routeContext, ctx) => {
  const role = ctx.user?.role;
  if (role !== "admin" && role !== "superadmin") {
    throw new ForbiddenError("Solo los administradores pueden cambiar la configuración");
  }

  let body;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError("Body inválido");
  }

  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findByPk(ctx.tenant.id);
  if (!tenant) throw new NotFoundError("Tenant no encontrado");

  // Objetos nuevos (no mutar el settings cacheado en memoria). Asignar un
  // objeto fresco garantiza además que Sequelize detecte el cambio del JSONB.
  const settings = { ...(tenant.settings ?? {}) };
  settings.brand = { ...(settings.brand ?? {}) };
  settings.integrations = { ...(settings.integrations ?? {}) };

  const updates = {};

  // Nombre del tenant (dato básico).
  if (typeof body.name === "string" && body.name.trim()) {
    updates.name = body.name.trim();
  }

  // Marca.
  if (body.brand && typeof body.brand === "object") {
    for (const k of ["primaryColor", "secondaryColor", "logoUrl"]) {
      if (k in body.brand) {
        const v = body.brand[k];
        settings.brand[k] = typeof v === "string" && v.trim() ? v.trim() : null;
      }
    }
  }

  // Claves de IA (secretos).
  applyKey(settings.integrations, "anthropicApiKey", body.anthropicApiKey);
  applyKey(settings.integrations, "googlePlacesApiKey", body.googlePlacesApiKey);

  updates.settings = settings;
  await tenant.update(updates);

  invalidateTenantCache(ctx.slug);

  return ok({
    name: tenant.name,
    brand: {
      primaryColor: settings.brand.primaryColor ?? null,
      secondaryColor: settings.brand.secondaryColor ?? null,
      logoUrl: settings.brand.logoUrl ?? null,
    },
    integrations: {
      anthropic: keyStatus(settings.integrations.anthropicApiKey),
      googlePlaces: keyStatus(settings.integrations.googlePlacesApiKey),
    },
  });
});
