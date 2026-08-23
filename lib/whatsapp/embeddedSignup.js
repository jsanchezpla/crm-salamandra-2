/**
 * lib/whatsapp/embeddedSignup.js — conectar la cuenta de WhatsApp de un cliente.
 *
 * (Fichero nuevo en /lib, regla #2: `whatsappConfig.js` MANDA mensajes con unas
 * credenciales que ya existen; esto es lo que hace que existan. Son momentos
 * distintos y clientes de la API distintos —aquí se habla con OAuth y con la
 * cuenta, no con `/messages`—, así que va aparte.)
 *
 * ── QUÉ ES ESTO ──────────────────────────────────────────────────────────────
 * El cliente pulsa "Conectar mi WhatsApp" en Configuración, se abre una ventana
 * de Meta, acepta, y vuelve con tres datos: el id de su cuenta de WhatsApp
 * (WABA), el id de su número y un **código canjeable**. Aquí se canjea ese
 * código por un token permanente de SU cuenta, se suscribe nuestra app a sus
 * webhooks y se guarda todo.
 *
 * Es lo que permite la COEXISTENCIA: su número sigue vivo en su móvil, con sus
 * chats, y a la vez el CRM puede mandar. La alternativa —dar de alta el número
 * a mano en el panel de Meta— obliga a borrar su cuenta de WhatsApp, y por eso
 * está descartada.
 *
 * ⚠️ **EL CÓDIGO CADUCA EN 30 SEGUNDOS.** No se guarda, no se encola, no se
 * manda a un job: se canjea en la misma petición en que llega. Si esto alguna
 * vez se mueve a una cola, dejará de funcionar y el error dirá algo que no tiene
 * nada que ver.
 *
 * ⚠️ Nada de esto se puede probar de verdad hasta que Salamandra sea Tech
 * Provider y exista la configuración de Embedded Signup: sin `META_CONFIG_ID`
 * no hay ventana que abrir. Las llamadas de aquí están escritas contra la
 * documentación y probadas con la respuesta de Meta simulada.
 */

const API_VERSION = "v21.0";

/** ¿Está el servidor listo para conectar cuentas? */
export function embeddedSignupConfigurado() {
  return !!(
    process.env.NEXT_PUBLIC_META_APP_ID &&
    process.env.NEXT_PUBLIC_META_CONFIG_ID &&
    process.env.WHATSAPP_APP_SECRET &&
    process.env.WHATSAPP_WEBHOOK_SECRET
  );
}

/**
 * La URL pública del CRM donde Meta tiene que entregar los webhooks.
 *
 * Se puede fijar con `WHATSAPP_WEBHOOK_BASE_URL`; si no, se deduce de la
 * petición (detrás del nginx de producción llega en `x-forwarded-*`).
 *
 * **Se exige https y se rechaza localhost.** No es celo: esta URL se queda
 * GUARDADA en Meta, así que conectar una cuenta desde el entorno local
 * registraría `http://localhost:3000` como destino de los mensajes de un
 * cliente real. No fallaría aquí — fallaría después, en silencio, con los
 * mensajes de sus pacientes yendo a una máquina que no existe.
 */
export function baseUrlWebhook(request) {
  const fijada = (process.env.WHATSAPP_WEBHOOK_BASE_URL || "").trim().replace(/\/$/, "");
  let base = fijada;
  if (!base) {
    try {
      const proto = request.headers.get("x-forwarded-proto");
      const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
      base = host ? `${proto || "https"}://${host}` : new URL(request.url).origin;
    } catch {
      base = "";
    }
  }
  if (!base) return { ok: false, error: "No se ha podido determinar la URL pública del CRM" };
  if (!/^https:\/\//i.test(base)) {
    return { ok: false, error: `La URL del webhook tiene que ser https (recibida: ${base})` };
  }
  if (/^https:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(base)) {
    return { ok: false, error: "No se puede conectar una cuenta de WhatsApp desde el entorno local" };
  }
  return { ok: true, base };
}

/** La URL del webhook de un cliente concreto. */
export function callbackDeTenant(base, slug) {
  return `${base}/api/webhooks/whatsapp/${slug}`;
}

async function pedirAMeta(url, opciones = {}) {
  try {
    const res = await fetch(url, opciones);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data?.error?.message || `HTTP ${res.status}`, codigo: data?.error?.code ?? null };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message, codigo: null };
  }
}

/**
 * Canjea el código de la ventana de Meta por el token permanente del cliente.
 *
 * El token que sale es **de la cuenta del cliente**, no nuestro: con él se le
 * mandan mensajes desde su número y se le cobra a él. Es exactamente el mismo
 * BYOK que Anthropic o Stripe, solo que aquí lo obtiene el CRM en vez de
 * pedírselo copiado a mano.
 */
export async function intercambiarCodigo(code) {
  if (!code) return { ok: false, error: "Falta el código de Meta" };
  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appId || !appSecret) return { ok: false, error: "La app de Meta no está configurada en el servidor" };

  const url =
    `https://graph.facebook.com/${API_VERSION}/oauth/access_token` +
    `?client_id=${encodeURIComponent(appId)}` +
    `&client_secret=${encodeURIComponent(appSecret)}` +
    `&code=${encodeURIComponent(code)}`;

  const res = await pedirAMeta(url);
  if (!res.ok) return res;
  const token = res.data?.access_token;
  if (!token) return { ok: false, error: "Meta no devolvió ningún token" };
  return { ok: true, token };
}

/**
 * Suscribe NUESTRA app a los webhooks de la cuenta del cliente, apuntando a SU
 * URL.
 *
 * `override_callback_uri` es lo que hace que cada cliente tenga su propio
 * endpoint en vez de caer todos en el mismo. Sin esta llamada la conexión queda
 * a medias de la peor forma posible: se podrían mandar mensajes pero no llegaría
 * ninguna respuesta ni el historial, y nadie se daría cuenta hasta que un
 * paciente se quejara de que no le contestan.
 */
export async function suscribirWebhook({ wabaId, token, callbackUrl, verifyToken }) {
  if (!wabaId) return { ok: false, error: "Falta el identificador de la cuenta de WhatsApp" };
  if (!token) return { ok: false, error: "Falta el token del cliente" };

  return await pedirAMeta(`https://graph.facebook.com/${API_VERSION}/${wabaId}/subscribed_apps`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ override_callback_uri: callbackUrl, verify_token: verifyToken }),
  });
}

/**
 * Lee el número recién conectado. No es imprescindible, pero es lo que permite
 * enseñar en pantalla "conectado: +34 6XX XXX XXX" en vez de un id opaco — y de
 * paso confirma que el token sirve de verdad, que es la única prueba real de
 * que la conexión ha ido bien.
 */
export async function datosDelNumero({ phoneNumberId, token }) {
  if (!phoneNumberId || !token) return { ok: false, error: "Faltan datos del número" };
  const res = await pedirAMeta(
    `https://graph.facebook.com/${API_VERSION}/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return res;
  return {
    ok: true,
    numero: res.data?.display_phone_number ?? null,
    nombre: res.data?.verified_name ?? null,
    calidad: res.data?.quality_rating ?? null,
  };
}
