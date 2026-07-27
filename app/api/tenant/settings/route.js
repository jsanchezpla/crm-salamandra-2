import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../lib/utils/apiResponse.js";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "../../../../lib/utils/errors.js";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { invalidateTenantCache } from "../../../../lib/tenant/tenantResolver.js";
import { isDemoTenant, assertNotDemoMasterWrite } from "../../../../lib/demo/isDemo.js";
import { encryptSecret, decryptSecret, isEncryptionConfigured } from "../../../../lib/crypto/secretBox.js";
import { isAllowedAnthropicModel, DEFAULT_ANTHROPIC_MODEL } from "../../../../lib/ai/anthropicModel.js";
import { getTenantStripeConfig } from "../../../../lib/payments/stripeConfig.js";

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
    // Cómo consigue su enlace una cita online: a mano (por defecto) o
    // heredado del tipo de cita (tenant con sala de videollamada contratada).
    meetModo: t.settings?.citas?.meetModo === "automatico" ? "automatico" : "manual",
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
      whatsapp: {
        ...ks(integ.whatsappToken),
        phoneNumberId: integ.whatsappPhoneNumberId ?? null,
      },
      resend: {
        ...ks(integ.resendApiKey),
        fromEmail: integ.resendFromEmail ?? null,
        replyTo: integ.resendReplyTo ?? null,
      },
      // Cobro online. `ready` = se puede cobrar de verdad: hacen falta AMBOS
      // secretos. Con la clave pero sin el secreto del webhook, el cliente pagaría
      // y su cita nunca se confirmaría (nadie nos avisa del cobro).
      stripe: {
        ...ks(integ.stripeSecretKey),
        publishableKey: integ.stripePublishableKey ?? null,
        webhook: keyStatus(integ.stripeWebhookSecret).configured,
        // Mismo criterio que el cobro real (getTenantStripeConfig): hay que poder
        // DESCIFRAR las claves, no solo que estén guardadas.
        ready: getTenantStripeConfig({ tenant: t }).configured,
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

  // ── Sin clave de cifrado no se guardan secretos ─────────────────────────────
  // `encryptSecret` degrada a texto plano cuando falta SETTINGS_ENCRYPTION_KEY
  // (ver lib/crypto/secretBox.js). Sin este guard, guardar la clave secreta de
  // Stripe con la variable sin configurar la dejaba LEGIBLE en la base de datos
  // — y la respuesta decía "configurada", así que nada delataba el problema.
  // `.env.production.example` trae la variable vacía, o sea que es un escenario
  // realista, no teórico.
  const CAMPOS_SECRETOS = [
    "anthropicApiKey",
    "googlePlacesApiKey",
    "openaiApiKey",
    "resendApiKey",
    "stripeSecretKey",
    "stripeWebhookSecret",
  ];
  const traeSecreto = CAMPOS_SECRETOS.some(
    (f) => typeof body[f] === "string" && body[f].trim() !== ""
  );
  if (traeSecreto && !isEncryptionConfigured()) {
    throw new AppError(
      "No se pueden guardar credenciales: falta la clave de cifrado del servidor (SETTINGS_ENCRYPTION_KEY). Avisa al administrador del sistema.",
      500
    );
  }

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

  // Cobro online (Stripe). La clave secreta y la del webhook son SECRETOS; la
  // publicable no lo es por definición (viaja al navegador).
  applyKey(settings.integrations, "stripeSecretKey", body.stripeSecretKey);
  applyKey(settings.integrations, "stripeWebhookSecret", body.stripeWebhookSecret);
  applyPlain(settings.integrations, "stripePublishableKey", body.stripePublishableKey);

  // Modelo de Claude (no es un secreto). Solo se guarda si es un id válido.
  if (typeof body.anthropicModel === "string" && isAllowedAnthropicModel(body.anthropicModel)) {
    settings.integrations.anthropicModel = body.anthropicModel;
  }
  applyPlain(settings.integrations, "resendReplyTo", body.resendReplyTo);

  // WhatsApp Cloud API (Meta): el token es SECRETO (se cifra como el resto de
  // claves); el identificador del número no lo es.
  applyKey(settings.integrations, "whatsappToken", body.whatsappToken);
  applyPlain(settings.integrations, "whatsappPhoneNumberId", body.whatsappPhoneNumberId);

  // Modo de videollamada del módulo Citas. Lista cerrada.
  if (body.meetModo === "manual" || body.meetModo === "automatico") {
    settings.citas = { ...(settings.citas ?? {}), meetModo: body.meetModo };
  }

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
    meetModo: settings.citas?.meetModo === "automatico" ? "automatico" : "manual",
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
      whatsapp: {
        ...keyStatus(settings.integrations.whatsappToken),
        phoneNumberId: settings.integrations.whatsappPhoneNumberId ?? null,
      },
      resend: {
        ...keyStatus(settings.integrations.resendApiKey),
        fromEmail: settings.integrations.resendFromEmail ?? null,
        replyTo: settings.integrations.resendReplyTo ?? null,
      },
      stripe: {
        ...keyStatus(settings.integrations.stripeSecretKey),
        publishableKey: settings.integrations.stripePublishableKey ?? null,
        webhook: keyStatus(settings.integrations.stripeWebhookSecret).configured,
        // MISMO criterio que usa el cobro de verdad (getTenantStripeConfig): no
        // basta con que las claves estén, hay que poder DESCIFRARLAS. Si se
        // rotara SETTINGS_ENCRYPTION_KEY, mirar la mera presencia diría "listo
        // para cobrar" mientras todos los cobros fallan.
        ready: getTenantStripeConfig({ tenant: { settings } }).configured,
      },
    },
  });
});
