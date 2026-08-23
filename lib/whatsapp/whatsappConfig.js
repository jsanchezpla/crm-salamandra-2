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
import { registrarEnviado } from "./inbox.js";
import { textoDeLaPlantilla } from "./plantillas.js";

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
 * El POST a Meta, que es lo único que comparten los dos tipos de envío.
 *
 * Devuelve { ok, id } o { ok:false, error, codigo }. NUNCA lanza: los avisos
 * por WhatsApp son best-effort, igual que los emails — que falle un mensaje no
 * puede tumbar la operación que lo originó (una cita, un menú, un ticket).
 *
 * `codigo` es el código de error de Meta, y se devuelve porque hay uno que
 * importa: el **131047** significa "han pasado más de 24 h desde el último
 * mensaje del paciente". Quien llame puede distinguir así un problema de
 * ventana —que se arregla mandando una plantilla— de una credencial mal puesta.
 */
async function postAMeta(ctx, cuerpo) {
  const { token, phoneNumberId, configurado } = getTenantWhatsappConfig(ctx);
  if (!configurado) return { ok: false, error: "WhatsApp no configurado en este cliente" };

  try {
    const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...cuerpo }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const motivo = data?.error?.message || `HTTP ${res.status}`;
      process.stderr.write(`[whatsapp] envío falló: ${motivo}\n`);
      return { ok: false, error: motivo, codigo: data?.error?.code ?? null };
    }
    return { ok: true, id: data?.messages?.[0]?.id ?? null };
  } catch (err) {
    process.stderr.write(`[whatsapp] envío falló: ${err.message}\n`);
    return { ok: false, error: err.message, codigo: null };
  }
}

/**
 * Texto libre. **Solo válido dentro de las 24 h siguientes al último mensaje
 * del paciente**: fuera de esa ventana Meta lo rechaza con el error 131047.
 * Para lo que inicia el negocio —avisos, recordatorios— hay que usar
 * `enviarWhatsappPlantilla`.
 *
 * `telefono` en formato internacional sin signos: 34612345678.
 */
export async function enviarWhatsapp(ctx, { telefono, texto, clientId = null }) {
  const destino = String(telefono || "").replace(/[^\d]/g, "");
  if (!destino) return { ok: false, error: "Teléfono no válido" };
  if (!texto || !String(texto).trim()) return { ok: false, error: "Mensaje vacío" };

  const cuerpo = String(texto).slice(0, 4000);
  const res = await postAMeta(ctx, { to: destino, type: "text", text: { body: cuerpo } });
  if (res.ok) {
    await registrarEnviado(ctx, { wamId: res.id, telefono: destino, clientId, tipo: "text", texto: cuerpo });
  }
  return res;
}

/**
 * Plantilla aprobada. Es lo que se puede mandar SIEMPRE, dentro y fuera de la
 * ventana de 24 h, y por tanto lo que sirve para los avisos de cita.
 *
 * `plantilla` es una entrada de `lib/whatsapp/plantillas.js` y `parametros` la
 * lista ORDENADA de sus variables ({{1}} es el primer elemento).
 *
 * Se guarda en el hilo el texto YA MONTADO, no el nombre de la plantilla: quien
 * abra la ficha del paciente dentro de un año quiere leer lo que se le dijo, no
 * un identificador de Meta que para entonces puede ni existir.
 */
export async function enviarWhatsappPlantilla(ctx, { telefono, plantilla, parametros = [], clientId = null }) {
  const destino = String(telefono || "").replace(/[^\d]/g, "");
  if (!destino) return { ok: false, error: "Teléfono no válido" };
  if (!plantilla?.nombre) return { ok: false, error: "Plantilla desconocida" };
  // Un parámetro vacío hace que Meta rechace el envío ENTERO. Se comprueba aquí
  // y no allí para que el motivo salga en nuestro log y no en un HTTP 400 opaco.
  if (parametros.some((p) => !String(p ?? "").trim())) {
    return { ok: false, error: `Plantilla ${plantilla.nombre}: hay parámetros vacíos` };
  }

  const res = await postAMeta(ctx, {
    to: destino,
    type: "template",
    template: {
      name: plantilla.nombre,
      language: { code: plantilla.idioma || "es" },
      ...(parametros.length
        ? { components: [{ type: "body", parameters: parametros.map((p) => ({ type: "text", text: String(p) })) }] }
        : {}),
    },
  });

  if (res.ok) {
    await registrarEnviado(ctx, {
      wamId: res.id,
      telefono: destino,
      clientId,
      tipo: "template",
      texto: textoDeLaPlantilla(plantilla, parametros),
    });
  }
  return res;
}
