import { SignJWT, jwtVerify } from "jose";

/**
 * Token de sesión del portal público "Mis citas".
 *
 * Tras canjear el `wpsso` de WordPress (ver `lib/citas/ssoToken.js`), el CRM
 * firma este sessionToken con SU PROPIO secreto (`CITAS_PORTAL_SESSION_SECRET`),
 * scope "citas-portal" y TTL ~60 min. El frontend lo guarda en sessionStorage y
 * lo envía en `Authorization: Bearer` en cada llamada de datos (no viaja en URL).
 *
 * Secreto propio del CRM, distinto de:
 *   - JWT_SECRET / JWT_REFRESH_SECRET  (auth de staff, `lib/auth/jwt.js`)
 *   - WIDGET_SSO_SECRETS               (compartido con WordPress, `lib/citas/ssoToken.js`)
 */

const SCOPE = "citas-portal";
const TTL = "60m";
export const SESSION_TTL_SECONDS = 60 * 60;

let secretMissingLogged = false;

function getKey() {
  const secret = process.env.CITAS_PORTAL_SESSION_SECRET;
  if (!secret) {
    if (!secretMissingLogged) {
      console.error("[portalSession] CITAS_PORTAL_SESSION_SECRET no configurado; portal de citas deshabilitado");
      secretMissingLogged = true;
    }
    return null;
  }
  return new TextEncoder().encode(secret);
}

/**
 * Firma un sessionToken para el email/tenant dados.
 * Lanza Error `.code` "SESSION_SECRET_MISSING" (→500) si falta el secreto del CRM.
 */
export async function signPortalSession({ email, tenant }) {
  const key = getKey();
  if (!key) {
    const err = new Error("SESSION_SECRET_MISSING");
    err.code = "SESSION_SECRET_MISSING";
    throw err;
  }
  return new SignJWT({ email, tenant, scope: SCOPE })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(TTL)
    .sign(key);
}

/**
 * Verifica el sessionToken para `slug`. Devuelve `{ email, tenant }`.
 * Lanza Error `.code` "SESSION_INVALID" (→401) si firma/exp/scope/tenant fallan.
 */
export async function verifyPortalSession(token, slug) {
  const key = getKey();
  const fail = () => {
    const err = new Error("SESSION_INVALID");
    err.code = "SESSION_INVALID";
    return err;
  };
  if (!key || !token) throw fail();

  let payload;
  try {
    ({ payload } = await jwtVerify(token, key, { algorithms: ["HS256"] }));
  } catch {
    throw fail();
  }
  if (payload.scope !== SCOPE || payload.tenant !== slug || typeof payload.email !== "string") {
    throw fail();
  }
  return { email: payload.email, tenant: payload.tenant };
}

/**
 * Extrae el bearer token de la cabecera Authorization, o null.
 */
export function readBearer(request) {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}
