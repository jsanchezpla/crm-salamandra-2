import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../lib/utils/apiResponse.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../../../../lib/utils/errors.js";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { invalidateTenantCache } from "../../../../lib/tenant/tenantResolver.js";
import { isDemoTenant, assertNotDemoMasterWrite } from "../../../../lib/demo/isDemo.js";
import { encryptSecret, decryptSecret } from "../../../../lib/crypto/secretBox.js";
import { isAllowedAnthropicModel, DEFAULT_ANTHROPIC_MODEL } from "../../../../lib/ai/anthropicModel.js";

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

// Nunca exponer la clave entera. Solo si está puesta + una pista corta. El valor
// guardado va cifrado, así que se descifra para calcular la pista (y si no se
// puede descifrar, se indica sin romper la respuesta).
function keyStatus(stored) {
  if (!stored || typeof stored !== "string") return { configured: false, hint: null };
  let key;
  try {
    key = decryptSecret(stored);
  } catch {
    return { configured: true, hint: "•••• (cifrada)" };
  }
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
  // Se guarda CIFRADA en reposo (lib/crypto/secretBox).
  if (typeof value === "string" && value.trim()) target[field] = encryptSecret(value.trim());
}

// Igual que applyKey pero SIN cifrar: para valores no-secretos (from, reply-to).
function applyPlain(target, field, value) {
  if (value === undefined) return;
  if (value === null || value === "") {
    delete target[field];
    return;
  }
  if (typeof value === "string" && value.trim()) target[field] = value.trim();
}

export const GET = withTenant(async (request, _routeContext, ctx) => {
  // Solo admin: la página de Configuración es de administradores (los perfiles
  // no-admin ni la ven en el menú) y esto expone pistas enmascaradas de las
  // claves de IA. La escritura (PATCH) ya estaba gateada.
  const role = ctx.user?.role;
  if (role !== "admin" && role !== "superadmin") {
    throw new ForbiddenError("Solo los administradores pueden ver la configuración");
  }

  const t = ctx.tenant;
  const brand = t.settings?.brand ?? {};
  const integ = t.settings?.integrations ?? {};

  // En la demo pública NO se filtra la pista de la clave (últimos 4 chars de una
  // credencial real): solo si está configurada o no.
  const demo = isDemoTenant(ctx);
  const ks = (stored) => {
    const r = keyStatus(stored);
    return demo ? { configured: r.configured, hint: null } : r;
  };

  return ok({
    name: t.name,
    slug: t.slug,
    plan: t.plan,
    readOnly: demo, // la UI deshabilita el guardado en la demo
    // Candado de la IA para empleados: "libre" (default) o "restringido".
    aiAccess: t.settings?.aiAccess === "restringido" ? "restringido" : "libre",
    brand: {
      primaryColor: brand.primaryColor ?? null,
      secondaryColor: brand.secondaryColor ?? null,
      logoUrl: brand.logoUrl ?? null,
    },
    integrations: {
      anthropic: {
        ...ks(integ.anthropicApiKey),
        model: isAllowedAnthropicModel(integ.anthropicModel) ? integ.anthropicModel : DEFAULT_ANTHROPIC_MODEL,
      },
      googlePlaces: ks(integ.googlePlacesApiKey),
      openai: ks(integ.openaiApiKey),
      resend: {
        ...ks(integ.resendApiKey),
        fromEmail: integ.resendFromEmail ?? null,
        replyTo: integ.resendReplyTo ?? null,
      },
    },
  });
});

export const PATCH = withTenant(async (request, _routeContext, ctx) => {
  const role = ctx.user?.role;
  if (role !== "admin" && role !== "superadmin") {
    throw new ForbiddenError("Solo los administradores pueden cambiar la configuración");
  }
  // La demo es pública: cualquiera entra como admin. Bloquear que un visitante
  // desfigure el tenant o borre/cambie claves en master (el reset no lo restaura).
  assertNotDemoMasterWrite(ctx);

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
  applyKey(settings.integrations, "openaiApiKey", body.openaiApiKey);
  applyKey(settings.integrations, "resendApiKey", body.resendApiKey);
  applyPlain(settings.integrations, "resendFromEmail", body.resendFromEmail);

  // Modelo de Claude (no es un secreto). Solo se guarda si es un id válido.
  if (typeof body.anthropicModel === "string" && isAllowedAnthropicModel(body.anthropicModel)) {
    settings.integrations.anthropicModel = body.anthropicModel;
  }
  applyPlain(settings.integrations, "resendReplyTo", body.resendReplyTo);

  // Candado de la IA para empleados (no es un secreto): lista cerrada.
  if (body.aiAccess === "libre" || body.aiAccess === "restringido") {
    settings.aiAccess = body.aiAccess;
  }

  updates.settings = settings;
  await tenant.update(updates);

  invalidateTenantCache(ctx.slug);

  return ok({
    name: tenant.name,
    aiAccess: settings.aiAccess === "restringido" ? "restringido" : "libre",
    brand: {
      primaryColor: settings.brand.primaryColor ?? null,
      secondaryColor: settings.brand.secondaryColor ?? null,
      logoUrl: settings.brand.logoUrl ?? null,
    },
    integrations: {
      anthropic: {
        ...keyStatus(settings.integrations.anthropicApiKey),
        model: isAllowedAnthropicModel(settings.integrations.anthropicModel) ? settings.integrations.anthropicModel : DEFAULT_ANTHROPIC_MODEL,
      },
      googlePlaces: keyStatus(settings.integrations.googlePlacesApiKey),
      openai: keyStatus(settings.integrations.openaiApiKey),
      resend: {
        ...keyStatus(settings.integrations.resendApiKey),
        fromEmail: settings.integrations.resendFromEmail ?? null,
        replyTo: settings.integrations.resendReplyTo ?? null,
      },
    },
  });
});
