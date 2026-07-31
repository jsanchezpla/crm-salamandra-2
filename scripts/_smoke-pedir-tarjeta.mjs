/**
 * _smoke-pedir-tarjeta.mjs — la tercera salida cuando el dinero se ha perdido.
 *
 * Si la reserva de la tarjeta caduca o el banco rechaza el cobro, la cita SIGUE
 * SIENDO una solicitud de una persona real. Además de "confirmar sin cobrar" y
 * "rechazar", la profesional puede pedirle la tarjeta otra vez: se crea una
 * retención NUEVA (la vieja está muerta y Stripe no deja reutilizarla) y se le
 * manda un enlace por correo.
 *
 * Lo que se fija aquí:
 *   · el enlace funciona y devuelve el formulario de SU cita;
 *   · la solicitud NO desaparece de la lista de espera mientras espera —el
 *     detalle que más fácil se rompe, porque 'authorizing' solo ocupa el hueco
 *     mientras su reloj siga vivo;
 *   · un token manipulado, de otro tenant o de una cita ya resuelta no abre nada.
 *
 * Requiere el servidor de desarrollo levantado.
 * Uso: node --env-file=.env.local scripts/_smoke-pedir-tarjeta.mjs [slug]
 */

import { Op } from "sequelize";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { getStripe, getTenantStripeConfig } from "../lib/payments/stripeConfig.js";
import { signAccessToken } from "../lib/auth/jwt.js";
import { ocupaHuecoWhere } from "../lib/citas/booking.js";

const SLUG = process.argv[2] || "nutri_laura";
const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const PRECIO = 4500;
const MARCA = "smoke-otratarjeta@example.com";
/** IP propia: el limite de /book es POR IP y la tanda entera desde una sola se agotaria el cupo. */
const IP_PRUEBA = "203.0.113.16";

let fallos = 0;
const ok = (m) => process.stdout.write(`  ✓ ${m}\n`);
const mal = (m) => { fallos++; process.stderr.write(`  ✗ ${m}\n`); };
const paso = (m) => process.stdout.write(`\n▶ ${m}\n`);
const esperar = (c, m) => (c ? ok(m) : mal(m));

async function main() {
  process.stdout.write(`\n═══ Smoke: pedirle otra tarjeta al paciente (${SLUG}) ═══\n`);

  getMasterDb();
  const { Tenant, User } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  const { models } = getTenantDb(SLUG);
  const { Booking, EventType, PaymentSession } = models;
  const ctx = { slug: SLUG, tenant, tenantModels: models };
  const stripe = await getStripe(ctx);
  const secreto = getTenantStripeConfig(ctx).webhookSecret;

  const admin = await User.findOne({ where: { tenantId: tenant.id, role: "admin" } });
  const token = await signAccessToken({
    userId: admin.id, email: admin.email, role: admin.role, tenantSlug: SLUG,
  });
  const authHeaders = { "Content-Type": "application/json", Cookie: `access_token=${token}` };

  const eventType = await EventType.findOne({ where: { active: true }, order: [["order", "ASC"]] });
  const precioOriginal = eventType.price;
  await eventType.update({ price: PRECIO });
  const intents = [];

  try {
    // ── Preparar: una cita cuya retención se ha muerto ──────────────────────
    paso("Preparando una cita con la retención perdida");
    let hora = null;
    for (let d = 4; d <= 24 && !hora; d++) {
      const dia = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
      const r = await fetch(`${BASE}/api/public/c/${SLUG}/availability?date=${dia}&eventTypeId=${eventType.id}`);
      const huecos = (await r.json())?.data?.slots ?? [];
      if (huecos.length) hora = huecos[huecos.length - 1].datetime;
    }
    if (!hora) throw new Error("sin huecos");

    const rb = await fetch(`${BASE}/api/public/c/${SLUG}/book`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-real-ip": IP_PRUEBA },
      body: JSON.stringify({
        eventTypeId: eventType.id, scheduledAt: hora,
        clientName: "Smoke OtraTarjeta", clientEmail: MARCA, clientPhone: "+34600222333",
        aceptaRetencion: true,
      }),
    });
    const bookingId = (await rb.json())?.data?.booking?.id;
    if (!bookingId) throw new Error("no se pudo reservar");

    const cita = await Booking.findByPk(bookingId);
    const psVieja = await PaymentSession.findByPk(cita.paymentSessionId);
    intents.push(psVieja.stripePaymentIntentId);
    const pi = await stripe.paymentIntents.confirm(psVieja.stripePaymentIntentId, { payment_method: "pm_card_visa" });

    const ev = (tipo, obj) => JSON.stringify({
      id: `evt_smoke_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`,
      object: "event", api_version: stripe.getApiField("version"),
      created: Math.floor(Date.now() / 1000), type: tipo, data: { object: obj },
    });
    const entregar = (cuerpo) => fetch(`${BASE}/api/webhooks/stripe/${SLUG}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": stripe.webhooks.generateTestHeaderString({ payload: cuerpo, secret: secreto }),
      },
      body: cuerpo,
    });

    await entregar(ev("payment_intent.amount_capturable_updated", pi));
    const muerto = await stripe.paymentIntents.cancel(psVieja.stripePaymentIntentId);
    await entregar(ev("payment_intent.canceled", muerto));
    await cita.reload();
    esperar(cita.paymentStatus === "void", `la cita se queda sin dinero (es '${cita.paymentStatus}')`);
    esperar(cita.status === "pending", `y sigue pendiente (es '${cita.status}')`);

    // ── Pedirle la tarjeta ──────────────────────────────────────────────────
    paso("1. La profesional le pide otra tarjeta");
    const rp = await fetch(`${BASE}/api/citas/bookings/${bookingId}/pedir-tarjeta`, {
      method: "POST", headers: authHeaders,
    });
    esperar(rp.status === 200, `responde 200 (es ${rp.status})`);
    const jp = (await rp.json())?.data ?? {};
    esperar(typeof jp.enlace === "string" && jp.enlace.includes("/pagar/"), "devuelve el enlace del correo");

    await cita.reload();
    esperar(cita.paymentStatus === "authorizing", `la cita vuelve a esperar tarjeta (es '${cita.paymentStatus}')`);
    esperar(cita.paymentSessionId !== psVieja.id, "con una retención NUEVA, no la muerta");
    const psNueva = await PaymentSession.findByPk(cita.paymentSessionId);
    intents.push(psNueva.stripePaymentIntentId);
    esperar(psNueva.stripePaymentIntentId !== psVieja.stripePaymentIntentId,
      "y otro PaymentIntent (el cancelado no se puede reutilizar)");

    // EL DETALLE QUE MÁS FÁCIL SE ROMPE
    paso("2. La solicitud NO desaparece mientras espera");
    const sigueOcupando = await Booking.count({
      where: { ...ocupaHuecoWhere(), id: cita.id },
    });
    esperar(sigueOcupando === 1, "sigue bloqueando su hora (si no, se le vendería a otro)");
    const enLista = await fetch(`${BASE}/api/citas/bookings?status=pending&limit=100`, { headers: authHeaders });
    const jLista = await enLista.json();
    // El endpoint devuelve { bookings, total, page, limit }. Leerlo a ciegas
    // como `.items` hacía que esta comprobación fallara siempre, dijera lo que
    // dijera el código: una prueba que no puede pasar no prueba nada.
    const lista = jLista?.data?.bookings;
    if (!Array.isArray(lista)) {
      mal(`no sé leer la lista de espera: ${JSON.stringify(jLista).slice(0, 160)}`);
    } else {
      esperar(lista.some((x) => x.id === cita.id),
        `y se sigue viendo en la lista de espera de la profesional (${lista.length} solicitud(es))`);
    }

    // ── El enlace ───────────────────────────────────────────────────────────
    paso("3. El enlace del correo abre SU formulario");
    const tk = jp.enlace.split("/pagar/")[1];
    const rg = await fetch(`${BASE}/api/public/c/${SLUG}/pagar/${tk}`);
    esperar(rg.status === 200, `responde 200 (es ${rg.status})`);
    const jg = (await rg.json())?.data ?? {};
    esperar(typeof jg.clientSecret === "string" && jg.clientSecret.startsWith("pi_"), "trae el clientSecret");
    esperar(jg.importe === PRECIO, `y el importe correcto (${jg.importe})`);
    esperar(jg.cita?.clientPhone === undefined, "sin filtrar el teléfono ni datos de más");

    paso("4. Tokens que no valen");
    const basura = await fetch(`${BASE}/api/public/c/${SLUG}/pagar/esto-no-es-un-token`);
    esperar(basura.status === 401, `token inventado → 401 (es ${basura.status})`);
    const otroTenant = await fetch(`${BASE}/api/public/c/demo/pagar/${tk}`);
    esperar([401, 404].includes(otroTenant.status),
      `el token de un tenant no vale en otro (es ${otroTenant.status})`);

    // ── El paciente pone la tarjeta ─────────────────────────────────────────
    paso("5. El paciente mete la tarjeta nueva");
    const pi2 = await stripe.paymentIntents.confirm(psNueva.stripePaymentIntentId, { payment_method: "pm_card_visa" });
    await entregar(ev("payment_intent.amount_capturable_updated", pi2));
    await cita.reload();
    esperar(cita.paymentStatus === "authorized", `vuelve a haber dinero retenido (es '${cita.paymentStatus}')`);
    esperar(cita.authorizationExpiresAt != null, "con su nueva fecha de caducidad");

    paso("6. Ya no tiene sentido volver a pedírsela");
    const rp2 = await fetch(`${BASE}/api/citas/bookings/${bookingId}/pedir-tarjeta`, {
      method: "POST", headers: authHeaders,
    });
    esperar(rp2.status === 409, `se rechaza (es ${rp2.status})`);
    const rg2 = await fetch(`${BASE}/api/public/c/${SLUG}/pagar/${tk}`);
    esperar(rg2.status === 409, `y el enlace viejo ya no abre formulario (es ${rg2.status})`);
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
    await PaymentSession.destroy({ where: { entityType: "booking", entityId: { [Op.in]: ids } } });
    const n = await Booking.destroy({ where: { id: ids } });
    await eventType.update({ price: precioOriginal });
    process.stdout.write(`  · ${n} cita(s) borradas; precio devuelto a ${precioOriginal ?? "sin precio"}\n`);
  }

  process.stdout.write(
    fallos === 0 ? "\n✓ TODO CORRECTO — se le puede pedir otra tarjeta sin perder la solicitud\n\n"
                 : `\n✗ ${fallos} comprobaciones fallidas\n\n`
  );
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write(`\n✗ ${e?.message ?? e}\n${e?.stack ?? ""}\n\n`);
  process.exit(1);
});
