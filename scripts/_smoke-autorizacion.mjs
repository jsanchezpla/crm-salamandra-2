/**
 * _smoke-autorizacion.mjs — prueba el ciclo completo de la retención de tarjeta
 * contra Stripe EN MODO PRUEBA. No toca citas: opera sobre una entidad ficticia.
 *
 * Prueba las tres funciones de lib/payments/autorizacion.js con dinero de
 * mentira y tarjetas de prueba de Stripe:
 *
 *   1. autorizar → confirmar con tarjeta → ¿queda en requires_capture?
 *   2. ¿trae Stripe el capture_before? (el plazo real de caducidad)
 *   3. capturar → ¿succeeded y con el importe correcto?
 *   4. autorizar otra vez → liberar → ¿canceled y sin cobrar nada?
 *   5. liberar dos veces → ¿no revienta? (tiene que ser idempotente)
 *   6. capturar algo ya liberado → ¿avisa con code CADUCADA?
 *
 * Uso:
 *   node --env-file=.env.local scripts/_smoke-autorizacion.mjs [slug]
 *
 * Se PARA si las claves del tenant no son de prueba (sk_test_): esto crea y
 * cancela cobros, y no debe correr jamás contra una cuenta de producción.
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { getTenantStripeConfig, getStripe } from "../lib/payments/stripeConfig.js";
import {
  autorizarPago,
  capturarPago,
  liberarAutorizacion,
  leerCaducidadAutorizacion,
} from "../lib/payments/autorizacion.js";

const SLUG = process.argv[2] || "nutri_laura";
const IMPORTE = 4550; // 45,50 € en céntimos

let fallos = 0;
const ok = (m) => process.stdout.write(`  ✓ ${m}\n`);
const mal = (m) => { fallos++; process.stderr.write(`  ✗ ${m}\n`); };
const info = (m) => process.stdout.write(`  · ${m}\n`);
const paso = (m) => process.stdout.write(`\n▶ ${m}\n`);

function esperar(cond, m) { cond ? ok(m) : mal(m); }

async function main() {
  process.stdout.write(`\n═══ Smoke: retención de tarjeta (${SLUG}) ═══\n`);

  getMasterDb();
  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) { process.stderr.write(`\n✗ Tenant "${SLUG}" no existe en esta base de datos.\n\n`); process.exit(1); }

  const { models: tenantModels } = getTenantDb(SLUG);
  const ctx = { slug: SLUG, tenant, tenantModels };

  const cfg = getTenantStripeConfig(ctx);
  if (!cfg.configured) {
    process.stderr.write(
      `\n✗ ${SLUG} no tiene Stripe configurado en esta base de datos.\n` +
      `  Hace falta clave secreta Y secreto de webhook:\n` +
      `    $env:STRIPE_SECRET_KEY="sk_test_..."\n` +
      `    $env:STRIPE_WEBHOOK_SECRET="whsec_..."\n` +
      `    $env:STRIPE_PUBLISHABLE_KEY="pk_test_..."\n` +
      `    node --env-file=.env.local scripts/configure-stripe-tenant.js ${SLUG}\n\n`
    );
    process.exit(1);
  }
  if (cfg.liveMode) {
    process.stderr.write(`\n✗ ${SLUG} tiene claves de PRODUCCIÓN (sk_live). Este script NO corre contra dinero real.\n\n`);
    process.exit(1);
  }
  ok("claves de PRUEBA detectadas (sk_test)");
  esperar(!!cfg.publishableKey, "clave publicable presente (la necesita el formulario embebido)");

  const stripe = await getStripe(ctx);
  const entityId = crypto.randomUUID();

  // ── 1. Autorizar ─────────────────────────────────────────────────────────
  paso("1. Autorizar (retener sin cobrar)");
  const { paymentSession, clientSecret } = await autorizarPago(ctx, {
    entityType: "smoke",
    entityId,
    amount: IMPORTE,
    description: "Smoke test retención",
    customerEmail: "smoke@example.com",
  });
  esperar(!!clientSecret, "devuelve clientSecret para el navegador");
  esperar(paymentSession.status === "authorizing", `PaymentSession nace 'authorizing' (es '${paymentSession.status}')`);

  let pi = await stripe.paymentIntents.retrieve(paymentSession.stripePaymentIntentId);
  esperar(pi.status === "requires_payment_method", `el intent espera tarjeta (es '${pi.status}')`);
  esperar(pi.capture_method === "manual", `captura MANUAL (es '${pi.capture_method}')`);
  esperar(
    Array.isArray(pi.payment_method_types) && pi.payment_method_types.length === 1 && pi.payment_method_types[0] === "card",
    `solo tarjeta (es '${(pi.payment_method_types || []).join(",")}') — Bizum/SEPA no admiten captura manual`
  );

  // ── 2. Confirmar la tarjeta (lo que hará el Payment Element) ─────────────
  paso("2. El paciente mete la tarjeta");
  pi = await stripe.paymentIntents.confirm(paymentSession.stripePaymentIntentId, {
    payment_method: "pm_card_visa",
  });
  esperar(pi.status === "requires_capture", `queda RETENIDO, sin cobrar (es '${pi.status}')`);
  esperar(pi.amount_received === 0, `todavía no ha entrado dinero (amount_received=${pi.amount_received})`);

  const charge = pi.latest_charge
    ? await stripe.charges.retrieve(typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge.id)
    : null;
  const caduca = leerCaducidadAutorizacion(charge);
  if (caduca) {
    const dias = ((caduca - Date.now()) / 86400000).toFixed(2);
    ok(`caducidad real de la retención: ${caduca.toISOString()} (${dias} días)`);
    // El diseño se eligió contando con ~7 días. Si Stripe diera bastante menos,
    // hay que enterarse AQUÍ y no cuando caduque la primera de verdad.
    esperar(Number(dias) >= 3, `el plazo da margen suficiente (${dias} días)`);
  } else {
    mal("no se pudo leer la caducidad — sin ella no se sabe cuándo muere una retención");
  }
  esperar(charge?.captured === false, "el cargo consta como NO capturado");

  // ── 3. Capturar ──────────────────────────────────────────────────────────
  paso("3. La profesional confirma → se cobra");
  const { importe } = await capturarPago(ctx, paymentSession);
  esperar(importe === IMPORTE, `cobra el importe exacto (${importe} vs ${IMPORTE})`);
  await paymentSession.reload();
  esperar(paymentSession.status === "paid", `PaymentSession queda 'paid' (es '${paymentSession.status}')`);
  pi = await stripe.paymentIntents.retrieve(paymentSession.stripePaymentIntentId);
  esperar(pi.status === "succeeded", `el intent queda 'succeeded' (es '${pi.status}')`);

  // ── 4. Capturar dos veces ────────────────────────────────────────────────
  paso("4. Doble captura (no puede cobrar dos veces)");
  try {
    await capturarPago(ctx, paymentSession);
    mal("dejó capturar dos veces");
  } catch (err) {
    esperar(err.code === "YA_CAPTURADO", `avisa con code YA_CAPTURADO (es '${err.code}')`);
  }

  // ── 5. Liberar ───────────────────────────────────────────────────────────
  paso("5. Rechazo: retener y soltar sin cobrar");
  const otra = await autorizarPago(ctx, {
    entityType: "smoke",
    entityId: crypto.randomUUID(),
    amount: IMPORTE,
    description: "Smoke test liberación",
  });
  await stripe.paymentIntents.confirm(otra.paymentSession.stripePaymentIntentId, {
    payment_method: "pm_card_visa",
  });
  const res = await liberarAutorizacion(ctx, otra.paymentSession, { motivo: "smoke" });
  esperar(res.liberada === true, "la libera");
  await otra.paymentSession.reload();
  esperar(otra.paymentSession.status === "void", `PaymentSession queda 'void' (es '${otra.paymentSession.status}')`);
  const piLib = await stripe.paymentIntents.retrieve(otra.paymentSession.stripePaymentIntentId);
  esperar(piLib.status === "canceled", `el intent queda 'canceled' (es '${piLib.status}')`);
  esperar(piLib.amount_received === 0, `no se cobró nada (amount_received=${piLib.amount_received})`);

  // ── 6. Liberar dos veces + capturar algo liberado ────────────────────────
  paso("6. Casos límite");
  const res2 = await liberarAutorizacion(ctx, otra.paymentSession, { motivo: "smoke otra vez" });
  esperar(res2.liberada === false, "liberar dos veces no revienta (idempotente)");
  try {
    await capturarPago(ctx, otra.paymentSession);
    mal("dejó capturar una retención ya liberada");
  } catch (err) {
    esperar(err.code === "CADUCADA", `capturar lo liberado avisa con code CADUCADA (es '${err.code}')`);
  }

  // ── Limpieza ─────────────────────────────────────────────────────────────
  paso("Limpieza");
  const borradas = await tenantModels.PaymentSession.destroy({ where: { entityType: "smoke" } });
  info(`${borradas} filas de prueba borradas`);

  process.stdout.write(
    fallos === 0
      ? "\n✓ TODO CORRECTO — el ciclo retener/cobrar/soltar funciona\n\n"
      : `\n✗ ${fallos} comprobaciones fallidas\n\n`
  );
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err?.message ?? err}\n${err?.stack ?? ""}\n\n`);
  process.exit(1);
});
