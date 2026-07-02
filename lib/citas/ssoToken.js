import { jwtVerify } from "jose";

/**
 * Verificación del token SSO que WordPress firma para el portal "Mis citas".
 *
 * WordPress (la web del tenant) firma un JWT HS256 corto (~5 min) con el email
 * del usuario logueado y lo pasa al iframe en `?wpsso=…`. El CRM lo verifica
 * aquí y lo canjea por un sessionToken propio (ver `lib/citas/portalSession.js`).
 *
 * El secreto es COMPARTIDO con WordPress y vive SOLO en env (regla #14):
 *   WIDGET_SSO_SECRETS='{"nutri_laura":"<hex 32B>"}'
 * Nunca en BD ni en el repo. Un secreto por tenant.
 *
 * Patrón "secret ausente → log ruidoso una vez" tomado de `lib/training/webhookAuth.js`.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let cachedSecrets = null;
let parseErrorLogged = false;
let secretMissingLogged = false;

function getSecretsMap() {
  if (cachedSecrets) return cachedSecrets;
  const raw = process.env.WIDGET_SSO_SECRETS;
  if (!raw) {
    cachedSecrets = new Map();
    return cachedSecrets;
  }
  try {
    const obj = JSON.parse(raw);
    cachedSecrets = new Map(Object.entries(obj));
  } catch {
    if (!parseErrorLogged) {
      console.error("[ssoToken] WIDGET_SSO_SECRETS no es JSON válido; SSO deshabilitado");
      parseErrorLogged = true;
    }
    cachedSecrets = new Map();
  }
  return cachedSecrets;
}

/**
 * Devuelve el secreto compartido con WordPress para `slug`, o null si no existe.
 */
export function getWidgetSsoSecret(slug) {
  const secret = getSecretsMap().get(slug);
  return typeof secret === "string" && secret.length > 0 ? secret : null;
}

function invalid() {
  const err = new Error("SSO_INVALID");
  err.code = "SSO_INVALID";
  return err;
}

/**
 * Verifica el token `wpsso` de WordPress para `slug`.
 * Devuelve `{ email }` normalizado (lowercase/trim).
 *
 * Lanza Error con `.code`:
 *   - "SSO_SECRET_MISSING" (→403): no hay secreto configurado para el tenant.
 *   - "SSO_INVALID"        (→401): firma/exp/payload inválidos.
 */
export async function verifyWpSsoToken(token, slug) {
  const secret = getWidgetSsoSecret(slug);
  if (!secret) {
    if (!secretMissingLogged) {
      console.error(`[ssoToken] Sin secreto WIDGET_SSO_SECRETS para "${slug}"; SSO rechazado`);
      secretMissingLogged = true;
    }
    const err = new Error("SSO_SECRET_MISSING");
    err.code = "SSO_SECRET_MISSING";
    throw err;
  }
  if (!token || typeof token !== "string") throw invalid();

  const key = new TextEncoder().encode(secret);
  let payload;
  try {
    ({ payload } = await jwtVerify(token, key, { algorithms: ["HS256"] }));
  } catch {
    throw invalid();
  }

  if (payload.tenant !== slug) throw invalid();

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) throw invalid();

  return { email };
}
