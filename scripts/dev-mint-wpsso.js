// @vivo — Utilidad de DESARROLLO genérica (slug + email, `--expired`) que firma un `wpsso` como lo haría WordPress para probar `/widget/c/<slug>/mi-perfil`… (leído el 19/08/2026; ver scripts/_hechos/README.md)
/**
 * dev-mint-wpsso.js — genera un token `wpsso` de PRUEBA (como lo firmaría
 * WordPress) para probar el portal «Mi perfil» (`/widget/c/<slug>/mi-perfil`;
 * `/mis-citas` fue su primer nombre y hoy redirige ahí) en local sin WordPress.
 *
 * Firma un JWT HS256 con el secreto de WIDGET_SSO_SECRETS[slug], payload
 * { email, tenant }, exp +5 min (o pasado con --expired). Imprime el token y la
 * URL del iframe.
 *
 * El secreto NO se lee aquí: lo da `getWidgetSsoSecret` (`lib/citas/ssoToken.js`),
 * el mismo que usa producción. Desde la rotación del 12/08/2026 el valor del
 * JSON puede ser un string suelto O una lista `["<nuevo>","<viejo>"]`, y para
 * FIRMAR vale solo el primero; leyendo el JSON a mano, una lista se convertía en
 * la cadena "nuevo,viejo" y el token salía firmado con algo que no acepta nadie.
 *
 * Uso:
 *   node --env-file=.env.local scripts/dev-mint-wpsso.js nutri_laura test@x.com
 *   node --env-file=.env.local scripts/dev-mint-wpsso.js nutri_laura test@x.com --expired
 */

import { SignJWT } from "jose";

import { getWidgetSsoSecret } from "../lib/citas/ssoToken.js";

async function main() {
  const [slug, email, ...rest] = process.argv.slice(2);
  if (!slug || !email) {
    process.stderr.write("Uso: node scripts/dev-mint-wpsso.js <slug> <email> [--expired]\n");
    process.exit(1);
  }
  const expired = rest.includes("--expired");

  const secret = getWidgetSsoSecret(slug);
  if (!secret) {
    process.stderr.write(
      `✗ Sin secreto para "${slug}": falta WIDGET_SSO_SECRETS, no es JSON válido o no trae ese slug.\n`
    );
    process.exit(1);
  }

  const key = new TextEncoder().encode(secret);
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = expired ? nowSec - 60 : nowSec + 300;

  const token = await new SignJWT({ email: String(email).trim().toLowerCase(), tenant: slug })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(nowSec)
    .setExpirationTime(expSec)
    .sign(key);

  const base = process.env.APP_BASE_URL || "http://localhost:3000";
  process.stdout.write(`\nwpsso (${expired ? "CADUCADO" : "válido 5 min"}):\n${token}\n\n`);
  process.stdout.write(`URL:\n${base}/widget/c/${slug}/mi-perfil?wpsso=${encodeURIComponent(token)}\n\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`✗ Error: ${err.message}\n`);
  process.exit(1);
});
