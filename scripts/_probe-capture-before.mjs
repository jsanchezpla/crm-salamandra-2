/**
 * _probe-capture-before.mjs — sonda: ¿de dónde sale el plazo de caducidad de una
 * retención? Autoriza, confirma con tarjeta de prueba y vuelca TODO lo que
 * Stripe dice sobre la caducidad, en el intent y en el cargo.
 *
 * Existe porque el diseño depende de leer `capture_before` en vez de calcular el
 * plazo por nuestra cuenta, y el smoke dijo que no venía. Antes de escribir
 * código sobre una suposición, se mira.
 *
 * Uso: node --env-file=.env.local scripts/_probe-capture-before.mjs [slug]
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { getStripe } from "../lib/payments/stripeConfig.js";

const SLUG = process.argv[2] || "nutri_laura";

async function main() {
  getMasterDb();
  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  const { models: tenantModels } = getTenantDb(SLUG);
  const ctx = { slug: SLUG, tenant, tenantModels };
  const stripe = await getStripe(ctx);

  process.stdout.write(`\nVersión de API que usa el SDK: ${stripe.getApiField("version")}\n`);

  const pi0 = await stripe.paymentIntents.create({
    amount: 1234,
    currency: "eur",
    capture_method: "manual",
    payment_method_types: ["card"],
  });
  const pi = await stripe.paymentIntents.confirm(pi0.id, { payment_method: "pm_card_visa" });

  process.stdout.write(`\nintent.status = ${pi.status}\n`);
  const camposIntent = Object.keys(pi).filter((k) => /captur|expir/i.test(k));
  process.stdout.write(`campos del intent con captur/expir: ${camposIntent.join(", ") || "(ninguno)"}\n`);

  const chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id;
  const charge = await stripe.charges.retrieve(chargeId);

  process.stdout.write(`\ncharge.id = ${charge.id}\n`);
  process.stdout.write(`charge.captured = ${charge.captured}\n`);
  const camposCharge = Object.keys(charge).filter((k) => /captur|expir/i.test(k));
  process.stdout.write(`campos del cargo con captur/expir: ${camposCharge.join(", ") || "(ninguno)"}\n`);
  for (const k of camposCharge) {
    const v = charge[k];
    const legible = typeof v === "number" && v > 1e9 ? ` → ${new Date(v * 1000).toISOString()}` : "";
    process.stdout.write(`  ${k} = ${JSON.stringify(v)}${legible}\n`);
  }

  const card = charge.payment_method_details?.card ?? {};
  const camposCard = Object.keys(card).filter((k) => /captur|expir|extended/i.test(k));
  process.stdout.write(
    `campos de payment_method_details.card con captur/expir: ${camposCard.join(", ") || "(ninguno)"}\n`
  );
  for (const k of camposCard) process.stdout.write(`  ${k} = ${JSON.stringify(card[k])}\n`);

  // Y ahora leyendo con una versión de API fijada y reciente, por si el SDK usa
  // una vieja donde el campo aún no existía.
  const chargeV = await stripe.charges.retrieve(chargeId, {}, { apiVersion: "2025-08-27.basil" });
  process.stdout.write(
    `\ncon apiVersion fijada: capture_before = ${JSON.stringify(chargeV.capture_before ?? null)}\n`
  );

  await stripe.paymentIntents.cancel(pi.id);
  process.stdout.write("\n(retención de la sonda cancelada)\n\n");
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(`\n✗ ${e.message}\n\n`);
  process.exit(1);
});
