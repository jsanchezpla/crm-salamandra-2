/**
 * Config de Stripe del tenant (BYOK) — mismo patrón que `lib/outreach/resendConfig.js`.
 *
 * El dinero es del CLIENTE (la nutricionista, el comercio…), así que la cuenta de
 * Stripe es SUYA y sus claves viven cifradas en `tenant.settings.integrations`
 * (AES-256-GCM, `lib/crypto/secretBox.js`). No hay fallback al `.env`: si el tenant
 * no ha configurado sus claves, no se cobra. Nunca se cobra "con la cuenta de otro".
 *
 * Claves:
 *   · stripeSecretKey     (cifrada)  — para llamar a la API
 *   · stripePublishableKey            — pública por definición, no se cifra
 *   · stripeWebhookSecret (cifrada)  — para verificar la firma de los webhooks
 */

import { decryptSecret } from "../crypto/secretBox.js";

function readSecret(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return decryptSecret(value).trim() || null;
  } catch {
    return null;
  }
}

export function getTenantStripeConfig(ctx) {
  const integ = ctx?.tenant?.settings?.integrations ?? {};
  const secretKey = readSecret(integ.stripeSecretKey);
  const webhookSecret = readSecret(integ.stripeWebhookSecret);
  const publishableKey = (integ.stripePublishableKey || "").trim() || null;

  return {
    secretKey,
    publishableKey,
    webhookSecret,
    // Se considera configurado solo con AMBOS secretos: sin el del webhook los
    // cobros se quedarían colgados sin confirmar nunca (el cliente paga y su cita
    // no se confirma), que es peor que no poder cobrar.
    configured: !!secretKey && !!webhookSecret,
    // Stripe distingue prueba/producción por el prefijo de la clave. No hay que
    // guardarlo aparte: se deduce, y así no puede desincronizarse.
    liveMode: !!secretKey && secretKey.startsWith("sk_live_"),
  };
}

export function tenantHasStripe(ctx) {
  return getTenantStripeConfig(ctx).configured;
}

/**
 * Instancia de Stripe del tenant. Import perezoso (como hace `resendClient.js`)
 * para no cargar el SDK en peticiones que no cobran.
 *
 * Devuelve null si el tenant no tiene Stripe configurado — el llamante decide qué
 * error dar.
 */
export async function getStripe(ctx) {
  const { secretKey } = getTenantStripeConfig(ctx);
  if (!secretKey) return null;
  const { default: Stripe } = await import("stripe");
  return new Stripe(secretKey);
}
