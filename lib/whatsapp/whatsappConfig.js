/**
 * lib/whatsapp/whatsappConfig.js — credenciales de WhatsApp por tenant.
 *
 * (Fichero nuevo en /lib, regla #2: mismo patrón que lib/ai/anthropicKey.js —
 * resolver una credencial BYOK desde el contexto del tenant, descifrándola al
 * vuelo, sin que ningún endpoint toque `settings.integrations` a mano.)
 *
 * BYOK, como el resto de integraciones de pago del CRM: cada cliente pone su
 * propia cuenta de WhatsApp Business (Meta Cloud API) en Configuración → IA e
 * integraciones. El CRM nunca usa una cuenta global: los mensajes salen del
 * número de cada negocio y el gasto es suyo.
 *
 * Qué hace falta (los dos datos que da Meta en su panel de desarrolladores):
 *   - Token de acceso permanente  → settings.integrations.whatsappToken (CIFRADO)
 *   - ID del número de teléfono   → settings.integrations.whatsappPhoneNumberId
 */

import { decryptSecret } from "../crypto/secretBox.js";

const API_VERSION = "v21.0";

/** { token, phoneNumberId, configurado } — token descifrado o null. */
export function getTenantWhatsappConfig(ctx) {
  const integ = ctx?.tenant?.settings?.integrations ?? {};
  let token = null;
  try {
    token = integ.whatsappToken ? decryptSecret(integ.whatsappToken) : null;
  } catch {
    token = null; // clave mal cifrada o SETTINGS_ENCRYPTION_KEY cambiada
  }
  const phoneNumberId = integ.whatsappPhoneNumberId || null;
  return { token, phoneNumberId, configurado: !!(token && phoneNumberId) };
}

/** ¿Este tenant puede mandar WhatsApp? */
export function tenantTieneWhatsapp(ctx) {
  return getTenantWhatsappConfig(ctx).configurado;
}

/**
 * Envía un mensaje de texto por WhatsApp Cloud API.
 *
 * Devuelve { ok, id } o { ok:false, error }. NUNCA lanza: los avisos por
 * WhatsApp son best-effort, igual que los emails — que falle un mensaje no
 * puede tumbar la operación que lo originó (una cita, un menú, un ticket).
 *
 * `telefono` en formato internacional sin signos: 34612345678.
 */
export async function enviarWhatsapp(ctx, { telefono, texto }) {
  const { token, phoneNumberId, configurado } = getTenantWhatsappConfig(ctx);
  if (!configurado) return { ok: false, error: "WhatsApp no configurado en este cliente" };

  const destino = String(telefono || "").replace(/[^\d]/g, "");
  if (!destino) return { ok: false, error: "Teléfono no válido" };
  if (!texto || !String(texto).trim()) return { ok: false, error: "Mensaje vacío" };

  try {
    const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: destino,
        type: "text",
        text: { body: String(texto).slice(0, 4000) },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const motivo = data?.error?.message || `HTTP ${res.status}`;
      process.stderr.write(`[whatsapp] envío falló: ${motivo}\n`);
      return { ok: false, error: motivo };
    }
    return { ok: true, id: data?.messages?.[0]?.id ?? null };
  } catch (err) {
    process.stderr.write(`[whatsapp] envío falló: ${err.message}\n`);
    return { ok: false, error: err.message };
  }
}
