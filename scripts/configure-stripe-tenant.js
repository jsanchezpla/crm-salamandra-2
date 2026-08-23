// @vivo — Genérico por slug; guarda (cifradas con `lib/crypto/secretBox.js`) o borra (`--borrar`) las claves de Stripe de un tenant leyéndolas de la env, y… (leído el 19/08/2026; ver scripts/_hechos/README.md)
/**
 * configure-stripe-tenant.js — guarda las claves de Stripe de un tenant.
 *
 * Las claves se leen de VARIABLES DE ENTORNO, nunca de argumentos de la línea de
 * comandos: los argumentos quedan en el historial del shell y en la lista de
 * procesos, donde cualquiera con acceso a la máquina los ve. Tampoco se imprimen
 * en ningún momento (regla #14).
 *
 * Se guardan CIFRADAS en `master.tenants.settings.integrations`
 * (AES-256-GCM, ver lib/crypto/secretBox.js), igual que las claves de IA.
 *
 * Uso (PowerShell):
 *   $env:STRIPE_SECRET_KEY="sk_test_..."
 *   $env:STRIPE_WEBHOOK_SECRET="whsec_..."
 *   node --env-file=.env.local scripts/configure-stripe-tenant.js nutri_laura
 *
 * Uso (bash / VPS):
 *   STRIPE_SECRET_KEY=sk_live_... STRIPE_WEBHOOK_SECRET=whsec_... \
 *     docker compose exec -T app node scripts/configure-stripe-tenant.js nutri_laura
 *
 * Para BORRAR las claves de un tenant:
 *   node --env-file=.env.local scripts/configure-stripe-tenant.js nutri_laura --borrar
 *
 * Idempotente.
 */

// No se importa invalidateTenantCache: el resolver arrastra next/server y no
// carga en un script suelto (mismo motivo documentado en
// add-showcase-modules-demo.js). La caché del tenant expira sola en 60 s.
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { encryptSecret } from "../lib/crypto/secretBox.js";

function log(m) { process.stdout.write(`  ${m}\n`); }

async function main() {
  const args = process.argv.slice(2);
  const slug = args.find((a) => !a.startsWith("--"));
  const borrar = args.includes("--borrar");

  process.stdout.write("\n▶ Claves de Stripe por tenant\n");

  if (!slug) {
    process.stderr.write("\n✗ Falta el slug.\n  Uso: node scripts/configure-stripe-tenant.js <slug> [--borrar]\n\n");
    process.exit(1);
  }

  const secret = (process.env.STRIPE_SECRET_KEY || "").trim();
  const webhook = (process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  const publishable = (process.env.STRIPE_PUBLISHABLE_KEY || "").trim();

  if (!borrar) {
    if (!secret) {
      process.stderr.write("\n✗ Falta STRIPE_SECRET_KEY en la env.\n\n");
      process.exit(1);
    }
    if (!/^sk_(test|live)_/.test(secret)) {
      process.stderr.write("\n✗ STRIPE_SECRET_KEY no parece una clave de Stripe (debe empezar por sk_test_ o sk_live_).\n\n");
      process.exit(1);
    }
    if (webhook && !/^whsec_/.test(webhook)) {
      process.stderr.write("\n✗ STRIPE_WEBHOOK_SECRET no parece válida (debe empezar por whsec_).\n\n");
      process.exit(1);
    }
  }

  const esLive = secret.startsWith("sk_live_");

  // Sin clave de cifrado, secretBox degrada a texto EN CLARO. Para una clave de
  // Stripe eso es inaceptable: quedaría legible en cualquier dump o backup de la
  // base de datos. Se para aquí, ANTES de escribir nada.
  if (!borrar && !(process.env.SETTINGS_ENCRYPTION_KEY || "").trim()) {
    process.stderr.write(
      "\n✗ SETTINGS_ENCRYPTION_KEY no está configurada.\n" +
        "  Sin ella la clave de Stripe se guardaría SIN CIFRAR en la base de datos.\n\n" +
        "  Genera una y añádela a tu .env (32 bytes aleatorios):\n" +
        "    node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"\n\n" +
        "  Es aditivo: los secretos ya guardados en claro se siguen leyendo igual.\n\n"
    );
    process.exit(1);
  }

  getMasterDb();
  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug } });
  if (!tenant) {
    process.stderr.write(`\n✗ Tenant "${slug}" no encontrado.\n\n`);
    process.exit(1);
  }

  const settings = { ...(tenant.settings || {}) };
  settings.integrations = { ...(settings.integrations || {}) };

  if (borrar) {
    delete settings.integrations.stripeSecretKey;
    delete settings.integrations.stripeWebhookSecret;
    delete settings.integrations.stripePublishableKey;
    await tenant.update({ settings });
    log(`✓ Claves de Stripe BORRADAS de "${slug}". El tenant deja de poder cobrar.`);
    log("  (la caché del tenant se refresca sola en ≤60 s)");
    process.exit(0);
  }

  settings.integrations.stripeSecretKey = encryptSecret(secret);
  if (webhook) settings.integrations.stripeWebhookSecret = encryptSecret(webhook);
  if (publishable) settings.integrations.stripePublishableKey = publishable;

  await tenant.update({ settings });

  log(`✓ Guardadas y cifradas para "${slug}" (la caché del tenant se refresca sola en ≤60 s)`);
  log(`  · modo: ${esLive ? "🔴 PRODUCCIÓN (sk_live) — se cobra DINERO REAL" : "🧪 pruebas (sk_test) — no se cobra nada real"}`);
  log(`  · clave secreta:  sí`);
  log(`  · secreto webhook: ${webhook ? "sí" : "NO — sin él, los cobros no se confirman nunca"}`);
  log(`  · clave publicable: ${publishable ? "sí" : "no (opcional, no se usa con Checkout)"}`);

  if (!webhook) {
    log("");
    log("  ⚠ Sin el secreto del webhook el cliente pagaría y su cita NO se confirmaría.");
    log("    `tenantHasStripe` lo exige, así que el cobro seguirá desactivado hasta ponerlo.");
  }
  if (esLive) {
    log("");
    log("  ⚠ Estás usando claves REALES. Asegúrate de que es la cuenta del profesional");
    log("    que debe recibir el dinero, y de que esto NO es un entorno local.");
  }

  process.stdout.write("\n");
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  process.exit(1);
});
