/**
 * lib/mailing/ses.js — cliente de Amazon SES (API v2) con las credenciales
 * del tenant.
 *
 * (Fichero nuevo en /lib, regla #2: mismo patrón que
 * `lib/whatsapp/whatsappConfig.js` y `lib/outreach/resendConfig.js` —resolver
 * una credencial BYOK desde el contexto del tenant, descifrándola al vuelo—,
 * para que ningún endpoint toque `settings.integrations` a mano.)
 *
 * ── POR QUÉ SES Y NO RESEND (decisión 1.1 del plan, 23/08/2026) ─────────────
 * Resend manda hoy las confirmaciones y los recordatorios de cita. La
 * reputación va pegada a la cuenta: si una campaña recoge quejas de spam, lo
 * primero que cae en «no deseado» son los recordatorios. Separar por
 * subdominio no protege de una suspensión de cuenta. La separación de verdad
 * es OTRO proveedor: el marketing sale por SES y lo transaccional se queda en
 * Resend. Y SES cuesta 0,10 $ por mil correos sin cuota mensual, que es lo que
 * exige el modelo de pago único de Salamandra.
 *
 * ── QUÉ HACE FALTA (Configuración → Conexiones → «Amazon SES») ──────────────
 *   sesAccessKeyId        el ID de la clave de acceso IAM (no es secreto)
 *   sesSecretAccessKey    la clave secreta, CIFRADA en reposo (secretBox)
 *   sesRegion             eu-west-1, eu-central-1, eu-south-2…
 *   sesFromEmail          remitente, de una identidad verificada en SU cuenta
 *   sesFromName           «Centro Aumenta» (opcional)
 *   sesConfigurationSet   el configuration set al que se enganchan los avisos
 *                         de rebote y queja (opcional pero recomendado)
 *
 * Nada de claves globales en el entorno: sin clave del cliente no se envía y
 * el módulo lo dice («sin configurar»), igual que la IA.
 *
 * Todo lo que habla con AWS devuelve `{ ok, ... }` y NUNCA lanza: quien llama
 * decide qué hacer con un fallo (marcar el envío como fallido, enseñar el
 * motivo). La firma la pone `sigv4.js`; aquí solo se montan las peticiones.
 */

import { decryptSecret } from "../crypto/secretBox.js";
import { firmarPeticion } from "./sigv4.js";

const REGION_RE = /^[a-z]{2}(-gov)?-[a-z]+-\d$/;

/** Config resuelta del tenant: `{ accessKeyId, secretAccessKey, region, fromEmail, fromName, configurationSet, configurado }`. */
export function getTenantSesConfig(ctx) {
  const integ = ctx?.tenant?.settings?.integrations ?? {};
  let secretAccessKey = null;
  try {
    secretAccessKey = integ.sesSecretAccessKey ? decryptSecret(integ.sesSecretAccessKey).trim() || null : null;
  } catch {
    secretAccessKey = null; // clave mal cifrada o SETTINGS_ENCRYPTION_KEY cambiada
  }
  const accessKeyId = String(integ.sesAccessKeyId ?? "").trim() || null;
  const region = REGION_RE.test(String(integ.sesRegion ?? "").trim()) ? String(integ.sesRegion).trim() : null;
  const fromEmail = String(integ.sesFromEmail ?? "").trim() || null;
  const fromName = String(integ.sesFromName ?? "").trim() || null;
  const configurationSet = String(integ.sesConfigurationSet ?? "").trim() || null;
  return {
    accessKeyId,
    secretAccessKey,
    region,
    fromEmail,
    fromName,
    configurationSet,
    configurado: !!(accessKeyId && secretAccessKey && region && fromEmail),
  };
}

/** ¿Este tenant puede mandar mailing? */
export function tenantTieneSes(ctx) {
  return getTenantSesConfig(ctx).configurado;
}

/** «Nombre <correo>» con el nombre entrecomillado si hace falta. */
export function remitenteDe(cfg) {
  if (!cfg?.fromEmail) return null;
  if (!cfg.fromName) return cfg.fromEmail;
  const nombre = cfg.fromName.replace(/["\\]/g, "").trim();
  return nombre ? `"${nombre}" <${cfg.fromEmail}>` : cfg.fromEmail;
}

function endpoint(cfg) {
  return `https://email.${cfg.region}.amazonaws.com`;
}

/**
 * Una llamada firmada a la API v2 de SES. Devuelve `{ ok, status, data, error, tipo }`.
 * `tipo` es el `x-amzn-ErrorType` de AWS (p. ej. `TooManyRequestsException`),
 * que es lo que distingue «espera un segundo» de «la clave está mal».
 */
export async function llamarSes(cfg, { method, path, body = null, timeoutMs = 15000 }) {
  if (!cfg?.accessKeyId || !cfg?.secretAccessKey || !cfg?.region) {
    return { ok: false, status: 0, error: "Amazon SES no está configurado en este cliente", tipo: "SinConfigurar" };
  }
  const url = `${endpoint(cfg)}${path}`;
  const cuerpo = body == null ? "" : JSON.stringify(body);
  const headers = body == null ? {} : { "content-type": "application/json" };
  let firmadas;
  try {
    firmadas = firmarPeticion({
      method,
      url,
      headers,
      body: cuerpo,
      region: cfg.region,
      service: "ses",
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    }).headers;
  } catch (err) {
    return { ok: false, status: 0, error: `No se pudo firmar la petición: ${err.message}`, tipo: "Firma" };
  }
  try {
    const res = await fetch(url, {
      method,
      headers: firmadas,
      body: body == null ? undefined : cuerpo,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const texto = await res.text();
    let data = null;
    try {
      data = texto ? JSON.parse(texto) : null;
    } catch {
      data = { raw: texto.slice(0, 500) };
    }
    if (!res.ok) {
      const tipo = (res.headers.get("x-amzn-errortype") || data?.__type || "").split(":")[0].split("#").pop() || `HTTP${res.status}`;
      const error = data?.message || data?.Message || `HTTP ${res.status}`;
      return { ok: false, status: res.status, data, error, tipo };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    const tipo = err?.name === "TimeoutError" ? "Timeout" : "Red";
    return { ok: false, status: 0, error: err.message, tipo };
  }
}

/** ¿Es un fallo de los que se vuelven a intentar (ritmo, red, 5xx)? */
export function errorReintentable(res) {
  if (!res || res.ok) return false;
  if (res.tipo === "TooManyRequestsException" || res.tipo === "Throttling" || res.tipo === "ThrottlingException") return true;
  if (res.tipo === "Timeout" || res.tipo === "Red") return true;
  return res.status >= 500;
}

/**
 * Manda UN correo. `{ ok: true, id }` o `{ ok: false, error, tipo, reintentable }`.
 *
 * @param {object} cfg  de `getTenantSesConfig`
 * @param {{ to: string, subject: string, html: string, text: string,
 *           replyTo?: string|null, headers?: Array<{name:string,value:string}>,
 *           tags?: Array<{name:string,value:string}> }} p
 */
export async function enviarSes(cfg, p) {
  const destino = String(p?.to ?? "").trim();
  if (!destino || !destino.includes("@")) return { ok: false, error: "Destinatario no válido", tipo: "Validacion" };
  if (!cfg?.fromEmail) return { ok: false, error: "Falta el remitente de SES", tipo: "SinConfigurar" };

  const body = {
    FromEmailAddress: remitenteDe(cfg),
    Destination: { ToAddresses: [destino] },
    Content: {
      Simple: {
        Subject: { Data: String(p.subject ?? "").slice(0, 998), Charset: "UTF-8" },
        Body: {
          Html: { Data: String(p.html ?? ""), Charset: "UTF-8" },
          Text: { Data: String(p.text ?? ""), Charset: "UTF-8" },
        },
        ...(p.headers?.length
          ? { Headers: p.headers.map((h) => ({ Name: String(h.name), Value: String(h.value) })) }
          : {}),
      },
    },
  };
  if (p.replyTo) body.ReplyToAddresses = [String(p.replyTo)];
  if (cfg.configurationSet) body.ConfigurationSetName = cfg.configurationSet;
  if (p.tags?.length) {
    // Los tags de SES admiten [a-zA-Z0-9_-] y como mucho 256 caracteres.
    body.EmailTags = p.tags
      .map((t) => ({ Name: String(t.name).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 256), Value: String(t.value).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 256) }))
      .filter((t) => t.Name && t.Value);
  }

  const res = await llamarSes(cfg, { method: "POST", path: "/v2/email/outbound-emails", body });
  if (!res.ok) {
    process.stderr.write(`[mailing:ses] envío a ${destino.replace(/(.).+(@.*)/, "$1***$2")} falló: ${res.tipo} ${res.error}\n`);
    return { ok: false, error: res.error, tipo: res.tipo, reintentable: errorReintentable(res) };
  }
  return { ok: true, id: res.data?.MessageId ?? null };
}

/**
 * La cuenta: si está en el sandbox, cuánto puede mandar al día y a qué ritmo.
 * `{ ok, sandbox, max24h, enviados24h, ritmoMax, envioActivo, error }`.
 */
export async function cuentaSes(cfg) {
  const res = await llamarSes(cfg, { method: "GET", path: "/v2/email/account" });
  if (!res.ok) return { ok: false, error: res.error, tipo: res.tipo };
  const d = res.data ?? {};
  const q = d.SendQuota ?? {};
  return {
    ok: true,
    sandbox: d.ProductionAccessEnabled === false,
    envioActivo: d.SendingEnabled !== false,
    max24h: Number(q.Max24HourSend ?? 0),
    enviados24h: Number(q.SentLast24Hours ?? 0),
    ritmoMax: Number(q.MaxSendRate ?? 1) || 1,
    estado: d.EnforcementStatus ?? null,
  };
}

/**
 * ¿El remitente está verificado en esa cuenta? Mira primero el dominio y
 * luego la dirección. `{ ok, verificado, identidad, tipo }`.
 */
export async function identidadDelRemitente(cfg) {
  const email = String(cfg?.fromEmail ?? "").trim().toLowerCase();
  const dominio = email.split("@")[1];
  if (!dominio) return { ok: false, error: "Remitente no válido" };
  for (const identidad of [dominio, email]) {
    const res = await llamarSes(cfg, { method: "GET", path: `/v2/email/identities/${encodeURIComponent(identidad)}` });
    if (res.ok) {
      return {
        ok: true,
        identidad,
        tipo: res.data?.IdentityType ?? null,
        verificado: res.data?.VerifiedForSendingStatus === true,
      };
    }
    if (res.tipo !== "NotFoundException") return { ok: false, error: res.error, tipo: res.tipo };
  }
  return { ok: true, identidad: null, verificado: false };
}

/** Coste orientativo de SES: 0,10 $ por cada 1.000 correos. */
export function costeEstimado(numCorreos) {
  const n = Math.max(0, Number(numCorreos) || 0);
  return Math.round((n / 1000) * 0.1 * 10000) / 10000;
}
