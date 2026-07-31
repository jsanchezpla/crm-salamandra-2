/**
 * _smoke-vigilar-retenciones.mjs — el vigilante de retenciones que caducan.
 *
 * Una retención muere sola a los ~7 días y Stripe no garantiza avisar. Si nadie
 * mira, el CRM le sigue enseñando a la profesional "Retenido, sin cobrar" sobre
 * un dinero que ya no existe: pulsaría "Confirmar y cobrar" esperando un ingreso
 * y se encontraría un error.
 *
 * Lo que se fija aquí:
 *   · avisa con tiempo y otra vez cuando queda poco, UNA vez cada cosa;
 *   · reconcilia las que ya murieron, dejándolo escrito;
 *   · y NO toca las que la fecha da por muertas pero Stripe dice que siguen
 *     vivas — actuar a ciegas sobre una fecha copiada es cómo se tira una
 *     retención buena.
 *
 * Requiere el servidor de desarrollo levantado.
 * Uso: node --env-file=.env.local scripts/_smoke-vigilar-retenciones.mjs [slug]
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { getStripe, getTenantStripeConfig } from "../lib/payments/stripeConfig.js";
import { vigilarRetencionesDeTenant } from "../lib/citas/caducidadRetencion.js";

const SLUG = process.argv[2] || "nutri_laura";
const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const PRECIO = 4500;
const MARCA = "smoke-caducidad@example.com";
/** IP propia: el limite de /book es POR IP y la tanda entera desde una sola se agotaria el cupo. */
const IP_PRUEBA = "203.0.113.14";
const HORA = 3600_000;

let fallos = 0;
const ok = (m) => process.stdout.write(`  ✓ ${m}\n`);
const mal = (m) => { fallos++; process.stderr.write(`  ✗ ${m}\n`); };
const paso = (m) => process.stdout.write(`\n▶ ${m}\n`);
const esperar = (c, m) => (c ? ok(m) : mal(m));

async function main() {
  process.stdout.write(`\n═══ Smoke: vigilancia de retenciones (${SLUG}) ═══\n`);

  getMasterDb();
  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  const { models } = getTenantDb(SLUG);
  const { Booking, EventType, PaymentSession, Notification } = models;
  const ctx = { slug: SLUG, tenant, tenantModels: models };
  const stripe = await getStripe(ctx);
  const secreto = getTenantStripeConfig(ctx).webhookSecret;

  const eventType = await EventType.findOne({ where: { active: true }, order: [["order", "ASC"]] });
  const precioOriginal = eventType.price;
  await eventType.update({ price: PRECIO });
  const intents = [];

  // Los días sin disponibilidad (fines de semana, festivos) no son un fallo del
  // vigilante: hay que saltarlos. Se va avanzando desde el offset pedido hasta
  // encontrar un hueco libre, y se recuerda cuál se usó para no repetirlo.
  const usados = new Set();

  /** Cita con la tarjeta retenida de verdad, y su caducidad puesta a mano. */
  async function retenida(desdeDia, caducaEnHoras) {
    let hora = null;
    for (let d = desdeDia; d <= desdeDia + 20 && !hora; d++) {
      const dia = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
      const r = await fetch(`${BASE}/api/public/c/${SLUG}/availability?date=${dia}&eventTypeId=${eventType.id}`);
      const huecos = (await r.json())?.data?.slots ?? [];
      const libre = huecos.map((h) => h.datetime).find((x) => !usados.has(x));
      if (libre) hora = libre;
    }
    if (!hora) return null;
    usados.add(hora);

    const rb = await fetch(`${BASE}/api/public/c/${SLUG}/book`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-real-ip": IP_PRUEBA },
      body: JSON.stringify({
        eventTypeId: eventType.id, scheduledAt: hora,
        clientName: "Smoke Caducidad", clientEmail: MARCA, clientPhone: "+34600444555",
        aceptaRetencion: true,
      }),
    });
    const jb = await rb.json();
    const bookingId = jb?.data?.booking?.id;
    if (!bookingId) {
      process.stderr.write(`      (no se pudo reservar: ${JSON.stringify(jb).slice(0, 160)})\n`);
      return null;
    }

    const cita = await Booking.findByPk(bookingId);
    const ps = await PaymentSession.findByPk(cita.paymentSessionId);
    intents.push(ps.stripePaymentIntentId);
    const pi = await stripe.paymentIntents.confirm(ps.stripePaymentIntentId, { payment_method: "pm_card_visa" });

    const ev = JSON.stringify({
      id: `evt_smoke_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`,
      object: "event", api_version: stripe.getApiField("version"),
      created: Math.floor(Date.now() / 1000),
      type: "payment_intent.amount_capturable_updated", data: { object: pi },
    });
    await fetch(`${BASE}/api/webhooks/stripe/${SLUG}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": stripe.webhooks.generateTestHeaderString({ payload: ev, secret: secreto }),
      },
      body: ev,
    });

    // Se falsea la caducidad para no tener que esperar 7 días.
    await cita.reload();
    await cita.update({ authorizationExpiresAt: new Date(Date.now() + caducaEnHoras * HORA) });
    return { cita, ps };
  }

  const avisosDe = (id, tipo) =>
    Notification.count({ where: { entityType: "Booking", entityId: id, type: tipo } });

  try {
    paso("Preparando cuatro retenciones en distintos momentos de su vida");
    const lejana = await retenida(3, 120);   // 5 días: no se toca
    const pronto = await retenida(5, 20);    // 20 h: aviso con tiempo
    const urgente = await retenida(7, 3);    // 3 h: última llamada
    const muerta = await retenida(9, -2);    // caducó hace 2 h
    if (!lejana || !pronto || !urgente || !muerta) throw new Error("no se pudieron preparar");
    ok("cuatro citas con dinero retenido de verdad");

    // La que "murió" se mata también en Stripe, que es lo que habría pasado.
    await stripe.paymentIntents.cancel(muerta.ps.stripePaymentIntentId);

    paso("1. Pasada en seco (--simular): no escribe nada");
    const sim = await vigilarRetencionesDeTenant(ctx, { simular: true });
    esperar(sim.revisadas === 3, `revisa las 3 que están en ventana, no la lejana (revisó ${sim.revisadas})`);
    esperar((await avisosDe(pronto.cita.id, "hold_caduca_pronto")) === 0, "y no ha creado ningún aviso");

    paso("2. Pasada de verdad");
    const r1 = await vigilarRetencionesDeTenant(ctx);
    esperar(r1.avisadas === 2, `avisa de las dos que van a caducar (avisó ${r1.avisadas})`);
    esperar(r1.reconciliadas === 1, `y reconcilia la que ya murió (reconcilió ${r1.reconciliadas})`);

    esperar((await avisosDe(pronto.cita.id, "hold_caduca_pronto")) > 0, "aviso 'caduca mañana' creado");
    esperar((await avisosDe(urgente.cita.id, "hold_caduca_ya")) > 0, "aviso 'caduca en unas horas' creado");
    esperar((await avisosDe(muerta.cita.id, "hold_caducado")) > 0, "aviso de retención caducada creado");

    paso("3. La que ya murió queda bien escrita");
    await muerta.cita.reload();
    esperar(muerta.cita.paymentStatus === "void", `marcada sin cobro (es '${muerta.cita.paymentStatus}')`);
    esperar(muerta.cita.status === "pending",
      `pero SIGUE EN LA LISTA DE ESPERA (es '${muerta.cita.status}') — hay una persona esperando`);
    await muerta.ps.reload();
    esperar(muerta.ps.status === "void", `la sesión de pago también (es '${muerta.ps.status}')`);

    paso("4. Correr otra vez no repite avisos");
    const r2 = await vigilarRetencionesDeTenant(ctx);
    esperar(r2.avisadas === 0, `ningún aviso nuevo (creó ${r2.avisadas})`);
    esperar((await avisosDe(pronto.cita.id, "hold_caduca_pronto")) === 1, "sigue habiendo UNO solo");

    paso("5. La lejana no se ha tocado");
    await lejana.cita.reload();
    esperar(lejana.cita.paymentStatus === "authorized", `sigue retenida (es '${lejana.cita.paymentStatus}')`);
    esperar((await avisosDe(lejana.cita.id, "hold_caduca_pronto")) === 0, "y sin avisos: aún queda tiempo");

    // ── El caso que de verdad importa ────────────────────────────────────────
    paso("6. Fecha vencida pero Stripe dice que sigue VIVA: no se toca");
    // `pronto` tiene dinero retenido de verdad en Stripe. Se le falsea la fecha
    // como si hubiera caducado: el vigilante debe preguntar a Stripe, ver que
    // sigue viva y NO tirarla.
    await pronto.cita.update({ authorizationExpiresAt: new Date(Date.now() - 3 * HORA) });
    await vigilarRetencionesDeTenant(ctx);
    await pronto.cita.reload();
    esperar(pronto.cita.paymentStatus === "authorized",
      `sigue 'authorized' (es '${pronto.cita.paymentStatus}') — no se tira una retención buena por una fecha copiada`);
  } finally {
    paso("Limpieza");
    for (const id of intents) {
      try {
        const p = await stripe.paymentIntents.retrieve(id);
        if (!["canceled", "succeeded"].includes(p.status)) await stripe.paymentIntents.cancel(id);
      } catch { /* ya no está */ }
    }
    const citas = await Booking.findAll({ where: { clientEmail: MARCA }, attributes: ["id"] });
    const ids = citas.map((x) => x.id);
    await Notification.destroy({ where: { entityType: "Booking", entityId: ids } });
    await PaymentSession.destroy({ where: { entityType: "booking", entityId: ids } });
    const n = await Booking.destroy({ where: { id: ids } });
    await eventType.update({ price: precioOriginal });
    process.stdout.write(`  · ${n} cita(s), sus cobros y sus avisos borrados\n`);
  }

  process.stdout.write(
    fallos === 0 ? "\n✓ TODO CORRECTO — el dinero que se muere no pasa desapercibido\n\n"
                 : `\n✗ ${fallos} comprobaciones fallidas\n\n`
  );
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write(`\n✗ ${e?.message ?? e}\n${e?.stack ?? ""}\n\n`);
  process.exit(1);
});
