/**
 * _smoke-cancelar-retencion.mjs — cancelar una cita con la tarjeta retenida
 * tiene que SOLTAR el dinero, por todas las vías.
 *
 * Antes del sprint de retención, cancelar solo sabía DEVOLVER, y la política de
 * reembolso ni miraba una cita que no constara 'paid'. Con dinero retenido eso
 * significaba dejar al paciente con el importe bloqueado en su tarjeta hasta que
 * caducara solo, días después, sin que nadie se enterara.
 *
 * Se prueban las dos vías que puede usar cada parte:
 *   · la profesional, borrando la cita desde el panel (DELETE) — que hasta
 *     ahora era la ÚNICA de las cinco que no liquidaba NADA;
 *   · el paciente, desde el enlace de su email (cancelación por token).
 *
 * Requiere el servidor de desarrollo levantado.
 * Uso: node --env-file=.env.local scripts/_smoke-cancelar-retencion.mjs [slug]
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { getStripe, getTenantStripeConfig } from "../lib/payments/stripeConfig.js";
import { signAccessToken } from "../lib/auth/jwt.js";

const SLUG = process.argv[2] || "nutri_laura";
const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const PRECIO = 4500;
const MARCA = "smoke-cancelar@example.com";
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
  process.stdout.write(`\n═══ Smoke: cancelar suelta la retención (${SLUG}) ═══\n`);

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

  /** Huecos ya gastados en esta pasada, para que las citas no se pisen. */
  const huecosUsados = new Set();

  /**
   * Deja una cita con la tarjeta retenida y esperando decisión.
   *
   * BUSCA HACIA DELANTE y REVIENTA si no encuentra hueco, en vez de devolver
   * `null`. Pedía siempre el día +4, que el 05/08/2026 caía en sábado: la
   * agenda no abre, no había huecos, y la prueba entera se quedaba sin montar.
   * Es el mismo fallo que tenía `_smoke-confirmar-cobrar`, donde además se
   * saltaba tres casos diciendo «TODO CORRECTO».
   */
  async function conTarjetaRetenida(dias) {
    let hora = null;
    for (let d = dias; d < dias + 21 && !hora; d++) {
      const dia = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
      const r = await fetch(`${BASE}/api/public/c/${SLUG}/availability?date=${dia}&eventTypeId=${eventType.id}`);
      const huecos = (await r.json())?.data?.slots ?? [];
      for (let i = huecos.length - 1; i >= 0; i--) {
        const cuando = horaDelHueco(huecos[i]);
        if (cuando && !huecosUsados.has(cuando)) { hora = cuando; break; }
      }
    }
    if (!hora) {
      throw new Error(
        `sin huecos libres entre el día +${dias} y el +${dias + 21}: no se puede montar el caso. ` +
        `Revisa los horarios de ${SLUG} antes de fiarte de esta prueba.`
      );
    }
    huecosUsados.add(hora);

    const rb = await fetch(`${BASE}/api/public/c/${SLUG}/book`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-real-ip": IP_PRUEBA },
      body: JSON.stringify({
        eventTypeId: eventType.id, scheduledAt: hora,
        clientName: "Smoke Cancelar", clientEmail: MARCA, clientPhone: "+34600999000",
        aceptaRetencion: true,
      }),
    });
    const respuesta = await rb.json();
    const bookingId = respuesta?.data?.booking?.id;
    if (!bookingId) {
      throw new Error(`no se pudo reservar el ${hora} (HTTP ${rb.status}): ${respuesta?.error ?? "sin motivo"}`);
    }

    const cita = await Booking.findByPk(bookingId);
    const ps = await PaymentSession.findByPk(cita.paymentSessionId);
    intents.push(ps.stripePaymentIntentId);
    const pi = await stripe.paymentIntents.confirm(ps.stripePaymentIntentId, { payment_method: "pm_card_visa" });

    const evento = JSON.stringify({
      id: `evt_smoke_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`,
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
    await cita.reload();
    return { cita, ps };
  }

  try {
    // ── La profesional borra desde el panel ─────────────────────────────────
    paso("1. La profesional cancela desde el panel (DELETE)");
    const a = await conTarjetaRetenida(4);
    if (!a) throw new Error("no se pudo preparar la cita");
    esperar(a.cita.paymentStatus === "authorized", `parte con dinero retenido (es '${a.cita.paymentStatus}')`);

    const rd = await fetch(`${BASE}/api/citas/bookings/${a.cita.id}?reason=Imprevisto`, {
      method: "DELETE", headers: authHeaders,
    });
    esperar(rd.status === 200 || rd.status === 204, `cancela (es ${rd.status})`);
    await a.cita.reload();
    esperar(a.cita.status === "cancelled", `la cita queda cancelada (es '${a.cita.status}')`);
    esperar(a.cita.paymentStatus === "void", `Y EL DINERO SE SUELTA (es '${a.cita.paymentStatus}')`);
    const piA = await stripe.paymentIntents.retrieve(a.ps.stripePaymentIntentId);
    esperar(piA.status === "canceled", `en Stripe está suelto de verdad (es '${piA.status}')`);
    esperar(piA.amount_received === 0, `sin cobrar nada (${piA.amount_received})`);

    // ── El paciente, desde el enlace de su email ────────────────────────────
    paso("2. El paciente cancela desde el enlace de su email");
    const b = await conTarjetaRetenida(6);
    if (b) {
      const rt = await fetch(`${BASE}/api/public/c/${SLUG}/cancel/${b.cita.cancellationToken}`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-real-ip": IP_PRUEBA },
        body: JSON.stringify({ reason: "Me ha surgido algo" }),
      });
      esperar(rt.status === 200, `cancela (es ${rt.status})`);
      await b.cita.reload();
      esperar(b.cita.status === "cancelled", `la cita queda cancelada (es '${b.cita.status}')`);
      esperar(b.cita.paymentStatus === "void", `y el dinero suelto (es '${b.cita.paymentStatus}')`);
      const piB = await stripe.paymentIntents.retrieve(b.ps.stripePaymentIntentId);
      esperar(piB.status === "canceled", `confirmado en Stripe (es '${piB.status}')`);
    }

    // ── Que lo de siempre siga funcionando ──────────────────────────────────
    paso("3. Una cita YA COBRADA se sigue devolviendo, no soltando");
    const c = await conTarjetaRetenida(8);
    if (c) {
      // Se confirma (y por tanto se cobra) antes de cancelar.
      await fetch(`${BASE}/api/citas/bookings/${c.cita.id}/confirm`, {
        method: "PATCH", headers: authHeaders, body: "{}",
      });
      await c.cita.reload();
      esperar(c.cita.paymentStatus === "paid", `queda cobrada (es '${c.cita.paymentStatus}')`);

      await fetch(`${BASE}/api/citas/bookings/${c.cita.id}?reason=Cancela la profesional`, {
        method: "DELETE", headers: authHeaders,
      });
      await c.cita.reload();
      esperar(c.cita.paymentStatus === "refunded",
        `ahora sí se DEVUELVE, no se suelta (es '${c.cita.paymentStatus}')`);
      const piC = await stripe.paymentIntents.retrieve(c.ps.stripePaymentIntentId);
      const devuelto = piC.latest_charge
        ? (await stripe.charges.retrieve(typeof piC.latest_charge === "string" ? piC.latest_charge : piC.latest_charge.id)).amount_refunded
        : 0;
      esperar(devuelto === PRECIO, `y por el importe íntegro (${devuelto})`);
    }
  } finally {
    paso("Limpieza");
    for (const id of intents) {
      try {
        const p = await stripe.paymentIntents.retrieve(id);
        if (!["canceled", "succeeded"].includes(p.status)) await stripe.paymentIntents.cancel(id);
      } catch { /* ya no está */ }
    }
    const citas = await Booking.findAll({ where: { clientEmail: MARCA }, attributes: ["id"] });
    await PaymentSession.destroy({ where: { entityType: "booking", entityId: citas.map((x) => x.id) } });
    const n = await Booking.destroy({ where: { clientEmail: MARCA } });
    await eventType.update({ price: precioOriginal });
    process.stdout.write(`  · ${n} cita(s) borradas; precio devuelto a ${precioOriginal ?? "sin precio"}\n`);
  }

  process.stdout.write(
    fallos === 0 ? "\n✓ TODO CORRECTO — cancelar suelta el dinero por todas las vías\n\n"
                 : `\n✗ ${fallos} comprobaciones fallidas\n\n`
  );
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write(`\n✗ ${e?.message ?? e}\n${e?.stack ?? ""}\n\n`);
  process.exit(1);
});
