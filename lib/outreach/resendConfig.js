/**
 * Config de Resend del tenant para el correo de Captación (BYOK).
 *
 * La **API key** sale SIEMPRE de Configuración → IA/Correo (cifrada en reposo),
 * sin fallback al `.env`. El **remitente** (from) y el **reply-to** salen de
 * Configuración si el tenant los pone; si no, del `.env` (OUTREACH_FROM_EMAIL /
 * OUTREACH_REPLY_TO), que sirve de valor compartido por defecto.
 *
 * Devuelve { apiKey, fromEmail, replyTo } (apiKey = null si el tenant no la puso
 * o no se puede descifrar).
 */

import { decryptSecret } from "../crypto/secretBox.js";

export function getTenantResendConfig(ctx) {
  const integ = ctx?.tenant?.settings?.integrations ?? {};

  let apiKey = null;
  if (typeof integ.resendApiKey === "string" && integ.resendApiKey.trim()) {
    try {
      apiKey = decryptSecret(integ.resendApiKey).trim() || null;
    } catch {
      apiKey = null;
    }
  }

  const fromEmail = (integ.resendFromEmail || "").trim() || process.env.OUTREACH_FROM_EMAIL || null;
  const replyTo = (integ.resendReplyTo || "").trim() || process.env.OUTREACH_REPLY_TO || null;

  return { apiKey, fromEmail, replyTo };
}
