/**
 * dev-cita-retenida.js — deja una solicitud REAL con la tarjeta retenida, para
 * poder mirar la lista de espera de la profesional con datos de verdad.
 *
 * Hace lo mismo que haría un paciente: reservar, meter tarjeta (con una de
 * prueba de Stripe) y esperar al webhook. Al terminar hay una cita 'pending' con
 * `paymentStatus: 'authorized'` y su caducidad anotada.
 *
 * A diferencia de los smoke, NO limpia al terminar: la deja ahí a propósito.
 * Para borrarla: `dev-limpiar-pruebas.js <slug>`.
 *
 * Con `--soltar` va un paso más allá: después de retener, mata la retención y
 * avisa por webhook, dejando la cita como quedaría si CADUCARA sola a los 7
 * días. Es el estado donde la profesional tiene delante a una persona real sin
 * dinero reservado, y el que enseña el botón de "Confirmar sin cobrar".
 *
 * Requiere el servidor de desarrollo levantado. Solo DESARROLLO.
 * Uso: node --env-file=.env.local scripts/dev-cita-retenida.js [slug] [euros] [--soltar]
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { getStripe, getTenantStripeConfig } from "../lib/payments/stripeConfig.js";

const SLUG = process.argv[2] || "nutri_laura";
const EUROS = Number(process.argv[3] || 45);
const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const MARCA = "smoke-vista@example.com";

async function main() {
  getMasterDb();
  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  const { models } = getTenantDb(SLUG);
  const { Booking, EventType, PaymentSession } = models;
  const ctx = { slug: SLUG, tenant, tenantModels: models };
  const stripe = await getStripe(ctx);
  const secreto = getTenantStripeConfig(ctx).webhookSecret;

  const eventType = await EventType.findOne({ where: { active: true }, order: [["order", "ASC"]] });
  const precio = Math.round(EUROS * 100);
  await eventType.update({ price: precio });
  process.stdout.write(`\n· "${eventType.name}" a ${EUROS} € (se queda así)\n`);

  let hora = null;
  for (let d = 2; d <= 25 && !hora; d++) {
    const dia = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
    const r = await fetch(`${BASE}/api/public/c/${SLUG}/availability?date=${dia}&eventTypeId=${eventType.id}`);
    const huecos = (await r.json())?.data?.slots ?? [];
    if (huecos.length) hora = huecos[huecos.length - 1]?.datetime;
  }
  if (!hora) { process.stderr.write("\n✗ No hay huecos libres.\n\n"); process.exit(1); }

  const rb = await fetch(`${BASE}/api/public/c/${SLUG}/book`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventTypeId: eventType.id, scheduledAt: hora,
      clientName: "Ana Vista Previa", clientEmail: MARCA, clientPhone: "+34600123123",
      aceptaRetencion: true,
    }),
  });
  const jb = await rb.json();
  const bookingId = jb?.data?.booking?.id;
  if (!bookingId) { process.stderr.write(`\n✗ ${JSON.stringify(jb).slice(0, 200)}\n\n`); process.exit(1); }

  const cita = await Booking.findByPk(bookingId);
  const ps = await PaymentSession.findByPk(cita.paymentSessionId);
  const pi = await stripe.paymentIntents.confirm(ps.stripePaymentIntentId, { payment_method: "pm_card_visa" });

  const evento = JSON.stringify({
    id: `evt_dev_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`,
    object: "event", api_version: stripe.getApiField("version"),
    created: Math.floor(Date.now() / 1000),
    type: "payment_intent.amount_capturable_updated", data: { object: pi },
  });
  await fetch(`${BASE}/api/webhooks/stripe/${SLUG}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "stripe-signature": stripe.webhooks.generateTestHeaderString({ payload: evento, secret: secreto }),
    },
    body: evento,
  });

  // ── Variante: dejarla SIN dinero, como si la retención hubiera caducado ──
  if (process.argv.includes("--soltar")) {
    const piMuerto = await stripe.paymentIntents.cancel(ps.stripePaymentIntentId);
    const ev2 = JSON.stringify({
      id: `evt_dev_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`,
      object: "event", api_version: stripe.getApiField("version"),
      created: Math.floor(Date.now() / 1000),
      type: "payment_intent.canceled", data: { object: piMuerto },
    });
    await fetch(`${BASE}/api/webhooks/stripe/${SLUG}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": stripe.webhooks.generateTestHeaderString({ payload: ev2, secret: secreto }),
      },
      body: ev2,
    });
    process.stdout.write("· retención liberada: la cita se queda esperando sin dinero\n");
  }

  await cita.reload();
  process.stdout.write(
    `✓ Solicitud lista: ${cita.clientName} — ${new Date(cita.scheduledAt).toLocaleString("es-ES")}\n` +
    `  estado: ${cita.status} / ${cita.paymentStatus}\n` +
    `  caduca: ${cita.authorizationExpiresAt ? new Date(cita.authorizationExpiresAt).toLocaleString("es-ES") : "—"}\n\n` +
    `  Míralo en ${BASE}/citas (pestaña Lista de espera)\n\n`
  );
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(`\n✗ ${e?.message ?? e}\n\n`);
  process.exit(1);
});
