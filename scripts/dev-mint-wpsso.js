/**
 * dev-mint-wpsso.js — genera un token `wpsso` de PRUEBA (como lo firmaría
 * WordPress) para probar el portal "Mis citas" en local sin WordPress.
 *
 * Firma un JWT HS256 con WIDGET_SSO_SECRETS[slug], payload { email, tenant },
 * exp +5 min (o pasado con --expired). Imprime el token y la URL del iframe.
 *
 * Uso:
 *   node --env-file=.env.local scripts/dev-mint-wpsso.js nutri_laura test@x.com
 *   node --env-file=.env.local scripts/dev-mint-wpsso.js nutri_laura test@x.com --expired
 */

import { SignJWT } from "jose";

async function main() {
  const [slug, email, ...rest] = process.argv.slice(2);
  if (!slug || !email) {
    process.stderr.write("Uso: node scripts/dev-mint-wpsso.js <slug> <email> [--expired]\n");
    process.exit(1);
  }
  const expired = rest.includes("--expired");

  const raw = process.env.WIDGET_SSO_SECRETS;
  if (!raw) {
    process.stderr.write("✗ Falta WIDGET_SSO_SECRETS en la env.\n");
    process.exit(1);
  }
  let secret;
  try {
    secret = JSON.parse(raw)[slug];
  } catch {
    process.stderr.write("✗ WIDGET_SSO_SECRETS no es JSON válido.\n");
    process.exit(1);
  }
  if (!secret) {
    process.stderr.write(`✗ No hay secreto para "${slug}" en WIDGET_SSO_SECRETS.\n`);
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
  process.stdout.write(`URL:\n${base}/widget/c/${slug}/mis-citas?wpsso=${encodeURIComponent(token)}\n\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`✗ Error: ${err.message}\n`);
  process.exit(1);
});
