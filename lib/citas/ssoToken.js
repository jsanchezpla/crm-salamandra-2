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
 * Nunca en BD ni en el repo.
 *
 * ── SE PUEDE PONER MÁS DE UNO POR CLIENTE, PARA ROTAR SIN CORTE (12/08/2026) ──
 *
 *   WIDGET_SSO_SECRETS='{"nutri_laura":["<nuevo>","<viejo>"]}'
 *
 * Antes era uno solo, y eso obligaba a cambiar el CRM y WordPress **al mismo
 * segundo**: entre un despliegue y el otro, todo lo que viaja firmado deja de
 * valer. Ya costó un corte en el portal de Laura.
 *
 * Con una lista, rotar deja de ser una maniobra sincronizada:
 *   1. Se pone el nuevo DELANTE del viejo y se despliega. Nada se rompe: se
 *      sigue aceptando el viejo, que es con el que WordPress firma todavía.
 *   2. Se cambia WordPress con calma.
 *   3. Se quita el viejo de la lista en el siguiente despliegue.
 *
 * La regla, y es la que hay que respetar al tocar esto:
 *   · para VERIFICAR lo que llega de WordPress valen TODOS;
 *   · para FIRMAR lo que el CRM le manda se usa el PRIMERO.
 * Al revés no funciona: firmando con el viejo, el paso 3 volvería a ser un corte.
 *
 * El formato de siempre —un string suelto— sigue valiendo tal cual, así que
 * `.env.production` no hay que tocarlo el día que esto se despliegue.
 *
 * Patrón "secret ausente → log ruidoso una vez" tomado de `lib/training/webhookAuth.js`.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let cachedSecrets = null;
let parseErrorLogged = false;
let secretMissingLogged = false;

/** Un valor del JSON (string suelto o lista) → lista de secretos utilizables. */
function normalizar(valor) {
  const lista = Array.isArray(valor) ? valor : [valor];
  return lista.filter((s) => typeof s === "string" && s.length > 0);
}

function getSecretsMap() {
  if (cachedSecrets) return cachedSecrets;
  const raw = process.env.WIDGET_SSO_SECRETS;
  if (!raw) {
    cachedSecrets = new Map();
    return cachedSecrets;
  }
  try {
    const obj = JSON.parse(raw);
    cachedSecrets = new Map(
      Object.entries(obj).map(([slug, valor]) => [slug, normalizar(valor)])
    );
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
 * TODOS los secretos válidos de `slug`, en orden. Para VERIFICAR.
 * Lista vacía si no hay ninguno.
 */
export function getWidgetSsoSecrets(slug) {
  return getSecretsMap().get(slug) ?? [];
}

/**
 * El secreto con el que se FIRMA lo que el CRM manda a WordPress: el primero de
 * la lista. Null si no hay ninguno.
 *
 * Los tres sitios que firman —`portalUser.js` (consultar y crear usuario) y
 * `syncWordpress.js`— siguen llamando aquí sin enterarse del cambio.
 */
export function getWidgetSsoSecret(slug) {
  return getWidgetSsoSecrets(slug)[0] ?? null;
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
  const secrets = getWidgetSsoSecrets(slug);
  if (secrets.length === 0) {
    if (!secretMissingLogged) {
      console.error(`[ssoToken] Sin secreto WIDGET_SSO_SECRETS para "${slug}"; SSO rechazado`);
      secretMissingLogged = true;
    }
    const err = new Error("SSO_SECRET_MISSING");
    err.code = "SSO_SECRET_MISSING";
    throw err;
  }
  if (!token || typeof token !== "string") throw invalid();

  // Vale cualquiera de los configurados: durante una rotación conviven el que
  // WordPress ya usa y el que usará. Con uno solo esto era una lista de uno.
  let payload = null;
  for (const secret of secrets) {
    try {
      ({ payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
        algorithms: ["HS256"],
      }));
      break;
    } catch {
      /* prueba el siguiente */
    }
  }
  if (!payload) throw invalid();

  if (payload.tenant !== slug) throw invalid();

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) throw invalid();

  return { email };
}
