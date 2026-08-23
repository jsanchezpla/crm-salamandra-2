import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * lib/whatsapp/webhookAuth.js — quién puede escribir en nuestro webhook.
 *
 * (Fichero nuevo en /lib, regla #2: `whatsappConfig.js` sabe MANDAR mensajes y
 * no tiene por qué saber nada de firmas ni de handshakes. Esto es la puerta de
 * entrada, y va aparte por la misma razón que `lib/training/` tiene su helper
 * de HMAC separado de la lógica de TutorLMS.)
 *
 * Dos cerrojos distintos, para dos momentos distintos:
 *
 *   1. ALTA (GET). Cuando se da de alta la URL en Meta, Meta llama una vez con
 *      `hub.verify_token` y espera que le devolvamos su `hub.challenge`. Es un
 *      "demuéstrame que esta URL es tuya".
 *
 *   2. USO (POST). Cada mensaje llega firmado en `X-Hub-Signature-256` con el
 *      **App Secret de nuestra app**. Esa es la barrera de verdad: sin ella,
 *      cualquiera que adivine la URL podría meter mensajes falsos en el CRM de
 *      un cliente.
 *
 * ── POR QUÉ EL TOKEN DE VERIFICACIÓN SE DERIVA Y NO SE GUARDA ────────────────
 * Cada cliente tiene su propia URL de webhook (`override_callback_uri` por
 * cuenta de WhatsApp), y por tanto necesita su propio token de verificación. La
 * alternativa era un campo más en `settings.integrations`, con su UI, su
 * cifrado y su migración — y un secreto más que alguien tiene que copiar a mano
 * entre dos paneles.
 *
 * En vez de eso se DERIVA de un único secreto del servidor:
 *
 *     token = HMAC-SHA256(WHATSAPP_WEBHOOK_SECRET, slug)
 *
 * Cada cliente saca un token distinto e inadivinable, es reproducible (se puede
 * volver a calcular para enseñarlo al configurar el override) y no hay nada que
 * guardar ni que sincronizar. Rotarlo es cambiar una variable de entorno, con
 * el coste conocido de tener que re-verificar las URLs en Meta.
 */

/** El token de verificación de un cliente. Lanza si falta el secreto. */
export function verifyTokenFor(slug) {
  const secreto = process.env.WHATSAPP_WEBHOOK_SECRET;
  if (!secreto) throw new Error("WHATSAPP_WEBHOOK_SECRET no configurado");
  if (!slug) throw new Error("slug vacío");
  return createHmac("sha256", secreto).update(`whatsapp:${slug}`).digest("hex").slice(0, 40);
}

/** Comparación en tiempo constante de dos cadenas. */
function igualesSeguro(a, b) {
  const x = Buffer.from(String(a ?? ""), "utf8");
  const y = Buffer.from(String(b ?? ""), "utf8");
  // timingSafeEqual exige la misma longitud; comparar antes filtra por tamaño,
  // que no es información aprovechable con un HMAC de longitud fija.
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/** ¿El `hub.verify_token` del alta es el de este cliente? */
export function tokenAltaValido(slug, recibido) {
  try {
    return igualesSeguro(verifyTokenFor(slug), recibido);
  } catch {
    return false; // sin secreto configurado no se valida nada
  }
}

/**
 * ¿Viene firmado por nuestra app? `cabecera` es `X-Hub-Signature-256`, con el
 * formato `sha256=<hex>`, y la firma se calcula sobre los BYTES EXACTOS del
 * cuerpo — por eso el endpoint tiene que leerlo con `request.text()` y no
 * parsear el JSON antes: `JSON.parse` + `JSON.stringify` reordena y reformatea,
 * y la firma dejaría de cuadrar.
 */
export function firmaValida(rawBody, cabecera) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret || !cabecera) return false;
  const recibida = String(cabecera).replace(/^sha256=/, "");
  const esperada = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  return igualesSeguro(esperada, recibida);
}

/** ¿Está el servidor configurado para atender webhooks de WhatsApp? */
export function webhookConfigurado() {
  return !!(process.env.WHATSAPP_WEBHOOK_SECRET && process.env.WHATSAPP_APP_SECRET);
}
