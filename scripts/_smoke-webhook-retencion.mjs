/**
 * _smoke-webhook-retencion.mjs — el eslabón donde la solicitud se vuelve real.
 *
 * Cuando el paciente confirma la tarjeta, Stripe retiene el dinero y avisa por
 * webhook. Hasta que ese aviso llega y se procesa, la cita NO está en la lista
 * de espera de la profesional. Si este paso falla, el paciente tiene dinero
 * bloqueado y la profesional no ve ninguna solicitud: el peor de los estados.
 *
 * No hace falta la CLI de Stripe: el SDK sabe firmar eventos de prueba con el
 * mismo secreto que el servidor usa para verificarlos, que es exactamente lo que
 * hace `stripe listen`. Los eventos se construyen a partir de PaymentIntents
 * REALES, no inventados, para que el cuerpo sea el que Stripe mandaría.
 *
 * Requiere el servidor de desarrollo levantado.
 * Uso: node --env-file=.env.local scripts/_smoke-webhook-retencion.mjs [slug]
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { getStripe, getTenantStripeConfig } from "../lib/payments/stripeConfig.js";

const SLUG = process.argv[2] || "nutri_laura";
const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const PRECIO = 4500;
const MARCA = "smoke-webhook@example.com";
/** IP propia: el limite de /book es POR IP y la tanda entera desde una sola se agotaria el cupo. */
// IP distinta en cada ejecución dentro del rango de documentación (RFC 5737):
// con una fija, lanzar la prueba dos veces seguidas agotaba el cupo por IP de
// /book y todo salía 429 — fallos que parecían del producto.
const IP_PRUEBA = `203.0.113.${20 + Math.floor(Math.random() * 200)}`;

let fallos = 0;
const ok = (m) => process.stdout.write(`  ✓ ${m}\n`);
const mal = (m) => { fallos++; process.stderr.write(`  ✗ ${m}\n`); };
const paso = (m) => process.stdout.write(`\n▶ ${m}\n`);
const esperar = (c, m) => (c ? ok(m) : mal(m));

function horaDelHueco(h) {
  const v = h?.datetime ?? h?.start ?? h?.scheduledAt ?? h?.time;
  if (!v) throw new Error(`No sé leer la hora de este hueco: ${JSON.stringify(h)}`);
  return v;
}

async function main() {
  process.stdout.write(`\n═══ Smoke: webhook de retención (${SLUG}) ═══\n`);

  getMasterDb();
  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  const { models } = getTenantDb(SLUG);
  const { Booking, EventType, PaymentSession, StripeWebhookEvent } = models;
  const ctx = { slug: SLUG, tenant, tenantModels: models };

  const stripe = await getStripe(ctx);
  const { webhookSecret } = getTenantStripeConfig(ctx);
  if (!webhookSecret) { process.stderr.write("✗ el tenant no tiene secreto de webhook\n"); process.exit(1); }

  /** Firma el evento igual que haría Stripe y lo entrega al endpoint. */
  async function entregar(tipo, objeto) {
    const evento = {
      // Id único por entrega: si se repite, el endpoint lo trata como reintento
      // (que es justo lo que se prueba en el paso de idempotencia).
      id: `evt_smoke_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`,
      object: "event",
      api_version: stripe.getApiField("version"),
      created: Math.floor(Date.now() / 1000),
      type: tipo,
      data: { object: objeto },
    };
    const cuerpo = JSON.stringify(evento);
    const firma = stripe.webhooks.generateTestHeaderString({ payload: cuerpo, secret: webhookSecret });
    const r = await fetch(`${BASE}/api/webhooks/stripe/${SLUG}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": firma },
      body: cuerpo,
    });
    let body = null;
    try { body = await r.json(); } catch { /* sin json */ }
    return { evento, status: r.status, body, cuerpo, firma };
  }

  const eventType = await EventType.findOne({ where: { active: true }, order: [["order", "ASC"]] });
  const precioOriginal = eventType.price;
  await eventType.update({ price: PRECIO });
  const intents = [];

  try {
    // ── Reservar y retener ──────────────────────────────────────────────────
    paso("1. Reservar y que el paciente meta la tarjeta");
    let hora = null;
    for (let d = 2; d <= 20 && !hora; d++) {
      const dia = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
      const r = await fetch(`${BASE}/api/public/c/${SLUG}/availability?date=${dia}&eventTypeId=${eventType.id}`);
      const j = await r.json();
      const huecos = j?.data?.slots ?? j?.data ?? [];
      if (Array.isArray(huecos) && huecos.length) hora = horaDelHueco(huecos[huecos.length - 1]);
    }
    if (!hora) throw new Error("sin huecos libres");

    const rb = await fetch(`${BASE}/api/public/c/${SLUG}/book`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-real-ip": IP_PRUEBA },
      body: JSON.stringify({
        eventTypeId: eventType.id, scheduledAt: hora,
        clientName: "Smoke Webhook", clientEmail: MARCA, clientPhone: "+34600333444",
        // Obligatorio desde que /book exige el consentimiento de la retención.
        aceptaRetencion: true,
      }),
    });
    const jb = await rb.json();
    const bookingId = jb?.data?.booking?.id;
    if (!bookingId) throw new Error(`no se pudo reservar: ${JSON.stringify(jb).slice(0, 200)}`);

    const cita = await Booking.findByPk(bookingId);
    const ps = await PaymentSession.findByPk(cita.paymentSessionId);
    intents.push(ps.stripePaymentIntentId);

    const pi = await stripe.paymentIntents.confirm(ps.stripePaymentIntentId, {
      payment_method: "pm_card_visa",
    });
    esperar(pi.status === "requires_capture", `Stripe retiene el dinero (es '${pi.status}')`);
    await cita.reload();
    esperar(cita.paymentStatus === "authorizing",
      `ANTES del webhook la cita sigue 'authorizing' (es '${cita.paymentStatus}')`);

    // ── El aviso de Stripe ──────────────────────────────────────────────────
    paso("2. Llega el webhook: la solicitud entra en la lista de espera");
    const e1 = await entregar("payment_intent.amount_capturable_updated", pi);
    esperar(e1.status === 200, `el endpoint acepta el evento (es ${e1.status})`);
    process.stdout.write(`      outcome: ${JSON.stringify(e1.body?.outcome)}\n`);

    await cita.reload();
    esperar(cita.paymentStatus === "authorized", `la cita pasa a 'authorized' (es '${cita.paymentStatus}')`);
    esperar(cita.status === "pending", `y sigue 'pending', esperando a la profesional (es '${cita.status}')`);
    esperar(cita.holdExpiresAt === null,
      "se suelta el reloj corto: ya no depende de que el paciente teclee");
    if (cita.authorizationExpiresAt) {
      const dias = ((new Date(cita.authorizationExpiresAt) - Date.now()) / 86400000).toFixed(2);
      ok(`queda anotado cuándo caduca el dinero: ${dias} días`);
      esperar(Number(dias) > 3, `con margen suficiente (${dias} días)`);
    } else {
      mal("NO se anotó la caducidad — sin ella nadie sabrá cuándo muere la retención");
    }

    await ps.reload();
    esperar(ps.status === "authorized", `la PaymentSession queda 'authorized' (es '${ps.status}')`);
    esperar(ps.authorizationExpiresAt != null, "y también guarda la caducidad");

    // ── Reintento ───────────────────────────────────────────────────────────
    paso("3. Stripe reintenta el MISMO evento (lo hace durante 3 días)");
    const repetido = { ...e1.evento };
    const cuerpoRep = JSON.stringify(repetido);
    const firmaRep = stripe.webhooks.generateTestHeaderString({ payload: cuerpoRep, secret: webhookSecret });
    const rr = await fetch(`${BASE}/api/webhooks/stripe/${SLUG}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": firmaRep },
      body: cuerpoRep,
    });
    const jr = await rr.json();
    esperar(rr.status === 200, `responde 200 (es ${rr.status})`);
    esperar(jr?.duplicate === true, "y lo reconoce como duplicado, sin repetir el trabajo");
    const vistos = await StripeWebhookEvent.count({ where: { stripeEventId: repetido.id } });
    esperar(vistos === 1, `una sola marca del evento (hay ${vistos})`);

    // ── Firma inválida ──────────────────────────────────────────────────────
    paso("4. Un evento con firma falsa NO puede entrar");
    const rf = await fetch(`${BASE}/api/webhooks/stripe/${SLUG}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": "t=1,v1=falso" },
      body: JSON.stringify({ id: "evt_falso", type: "payment_intent.succeeded", data: { object: {} } }),
    });
    esperar(rf.status === 400, `se rechaza con 400 (es ${rf.status})`);

    // ── Liberación ──────────────────────────────────────────────────────────
    paso("5. Se suelta la retención: la cita NO se cancela sola");
    const piCancel = await stripe.paymentIntents.cancel(ps.stripePaymentIntentId);
    const e2 = await entregar("payment_intent.canceled", piCancel);
    esperar(e2.status === 200, `el endpoint acepta el evento (es ${e2.status})`);
    await cita.reload();
    esperar(cita.paymentStatus === "void", `la cita queda sin cobro (es '${cita.paymentStatus}')`);
    esperar(cita.status === "pending",
      `pero SIGUE EN PIE esperando decisión (es '${cita.status}') — hay una persona real detrás`);
  } finally {
    paso("Limpieza");
    for (const id of intents) {
      try {
        const p = await stripe.paymentIntents.retrieve(id);
        if (!["canceled", "succeeded"].includes(p.status)) await stripe.paymentIntents.cancel(id);
      } catch { /* ya no está */ }
    }
    const citas = await Booking.findAll({ where: { clientEmail: MARCA }, attributes: ["id"] });
    await PaymentSession.destroy({ where: { entityType: "booking", entityId: citas.map((c) => c.id) } });
    const n = await Booking.destroy({ where: { clientEmail: MARCA } });
    await eventType.update({ price: precioOriginal });
    process.stdout.write(`  · ${n} cita(s) borradas; precio devuelto a ${precioOriginal ?? "sin precio"}\n`);
  }

  process.stdout.write(
    fallos === 0 ? "\n✓ TODO CORRECTO — el webhook mete la solicitud en la lista de espera\n\n"
                 : `\n✗ ${fallos} comprobaciones fallidas\n\n`
  );
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write(`\n✗ ${e?.message ?? e}\n${e?.stack ?? ""}\n\n`);
  process.exit(1);
});
