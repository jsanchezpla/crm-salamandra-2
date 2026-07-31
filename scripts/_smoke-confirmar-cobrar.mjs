/**
 * _smoke-confirmar-cobrar.mjs — el momento en que se mueve el dinero.
 *
 * La profesional confirma una solicitud con la tarjeta retenida y ahí, y solo
 * ahí, se le cobra al paciente. Este script ataca las rutas REALES por HTTP
 * (`/confirm` y `/reject`), con sesión de admin, para cubrir también el candado
 * de rol, el lock y las validaciones — no solo la lógica del cobro.
 *
 * LA REGLA QUE FIJA: si no hay dinero, la cita NO se confirma. Nunca puede
 * existir "confirmada pero el cobro falló", porque es el estado que hace que
 * ella cierre su agenda creyendo que ha cobrado.
 *
 * La sesión se firma con el JWT_SECRET del entorno para un usuario admin que YA
 * existe. Es lo mismo que hace el login una vez ha comprobado la contraseña;
 * aquí no se toca ninguna contraseña.
 *
 * Requiere el servidor de desarrollo levantado.
 * Uso: node --env-file=.env.local scripts/_smoke-confirmar-cobrar.mjs [slug]
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { getStripe } from "../lib/payments/stripeConfig.js";
import { signAccessToken } from "../lib/auth/jwt.js";

const SLUG = process.argv[2] || "nutri_laura";
const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const PRECIO = 4500;
const MARCA = "smoke-cobro@example.com";

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
  process.stdout.write(`\n═══ Smoke: confirmar cobra, rechazar suelta (${SLUG}) ═══\n`);

  getMasterDb();
  const { Tenant, User } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  const { models } = getTenantDb(SLUG);
  const { Booking, EventType, PaymentSession } = models;
  const ctx = { slug: SLUG, tenant, tenantModels: models };
  const stripe = await getStripe(ctx);

  const admin = await User.findOne({ where: { tenantId: tenant.id, role: "admin" } });
  if (!admin) { process.stderr.write(`✗ ${SLUG} no tiene ningún usuario admin\n`); process.exit(1); }
  const token = await signAccessToken({
    userId: admin.id, email: admin.email, role: admin.role, tenantSlug: SLUG,
  });
  const authHeaders = { "Content-Type": "application/json", Cookie: `access_token=${token}` };
  ok(`sesión de admin firmada para ${admin.email}`);

  const eventType = await EventType.findOne({ where: { active: true }, order: [["order", "ASC"]] });
  const precioOriginal = eventType.price;
  await eventType.update({ price: PRECIO });
  const intents = [];

  /** Reserva + tarjeta retenida + webhook, dejando la cita lista para decidir. */
  async function solicitudConTarjetaRetenida(dias) {
    const dia = new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);
    const r = await fetch(`${BASE}/api/public/c/${SLUG}/availability?date=${dia}&eventTypeId=${eventType.id}`);
    const j = await r.json();
    const huecos = j?.data?.slots ?? j?.data ?? [];
    if (!Array.isArray(huecos) || !huecos.length) return null;

    const rb = await fetch(`${BASE}/api/public/c/${SLUG}/book`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventTypeId: eventType.id, scheduledAt: horaDelHueco(huecos[huecos.length - 1]),
        clientName: "Smoke Cobro", clientEmail: MARCA, clientPhone: "+34600555666",
        // Obligatorio desde que /book exige el consentimiento de la retención.
        aceptaRetencion: true,
      }),
    });
    const jb = await rb.json();
    const bookingId = jb?.data?.booking?.id;
    if (!bookingId) return null;

    const cita = await Booking.findByPk(bookingId);
    const ps = await PaymentSession.findByPk(cita.paymentSessionId);
    intents.push(ps.stripePaymentIntentId);
    const pi = await stripe.paymentIntents.confirm(ps.stripePaymentIntentId, { payment_method: "pm_card_visa" });

    // El webhook, firmado como haría Stripe.
    const { getTenantStripeConfig } = await import("../lib/payments/stripeConfig.js");
    const secreto = getTenantStripeConfig(ctx).webhookSecret;
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
    // ── 1. Confirmar cobra ───────────────────────────────────────────────────
    paso("1. La profesional CONFIRMA → se cobra");
    const a = await solicitudConTarjetaRetenida(3);
    if (!a) throw new Error("no se pudo preparar la solicitud");
    esperar(a.cita.paymentStatus === "authorized", `parte de 'authorized' (es '${a.cita.paymentStatus}')`);

    const rc = await fetch(`${BASE}/api/citas/bookings/${a.cita.id}/confirm`, {
      method: "PATCH", headers: authHeaders, body: "{}",
    });
    esperar(rc.status === 200, `confirma con 200 (es ${rc.status})`);
    await a.cita.reload();
    esperar(a.cita.status === "confirmed", `la cita queda confirmada (es '${a.cita.status}')`);
    esperar(a.cita.paymentStatus === "paid", `y COBRADA (es '${a.cita.paymentStatus}')`);

    const piA = await stripe.paymentIntents.retrieve(a.ps.stripePaymentIntentId);
    esperar(piA.status === "succeeded", `en Stripe consta cobrado (es '${piA.status}')`);
    esperar(piA.amount_received === PRECIO, `por el importe exacto (${piA.amount_received})`);

    // ── 2. Confirmar dos veces ───────────────────────────────────────────────
    paso("2. Confirmar dos veces no cobra dos veces");
    const rc2 = await fetch(`${BASE}/api/citas/bookings/${a.cita.id}/confirm`, {
      method: "PATCH", headers: authHeaders, body: "{}",
    });
    esperar(rc2.status === 200, `responde 200 (es ${rc2.status})`);
    const piA2 = await stripe.paymentIntents.retrieve(a.ps.stripePaymentIntentId);
    esperar(piA2.amount_received === PRECIO, `sigue habiendo UN solo cobro (${piA2.amount_received})`);

    // ── 3. Sin sesión ────────────────────────────────────────────────────────
    paso("3. Sin sesión de admin no se cobra a nadie");
    const b = await solicitudConTarjetaRetenida(5);
    if (b) {
      const rSin = await fetch(`${BASE}/api/citas/bookings/${b.cita.id}/confirm`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      esperar(rSin.status === 401 || rSin.status === 403, `rechazado (es ${rSin.status})`);
      await b.cita.reload();
      esperar(b.cita.paymentStatus === "authorized", `el dinero sigue solo retenido (es '${b.cita.paymentStatus}')`);
    }

    // ── 4. LA REGLA DE ORO ───────────────────────────────────────────────────
    paso("4. Si el cobro no puede hacerse, la cita NO se confirma");
    if (b) {
      // Se mata la retención por detrás: es exactamente lo que pasa cuando
      // caduca sola a los 7 días.
      await stripe.paymentIntents.cancel(b.ps.stripePaymentIntentId);
      const rFail = await fetch(`${BASE}/api/citas/bookings/${b.cita.id}/confirm`, {
        method: "PATCH", headers: authHeaders, body: "{}",
      });
      esperar(rFail.status === 409, `responde 409 y no confirma (es ${rFail.status})`);
      const jFail = await rFail.json();
      process.stdout.write(`      dice: "${jFail?.error}"\n`);
      await b.cita.reload();
      esperar(b.cita.status === "pending",
        `LA CITA SIGUE PENDIENTE (es '${b.cita.status}') — nunca "confirmada sin cobro"`);
      esperar(b.cita.paymentStatus === "void", `y marcada sin cobro (es '${b.cita.paymentStatus}')`);

      // ── 5. Confirmar sin cobrar ────────────────────────────────────────────
      paso("5. La salida cuando caduca: confirmar sin cobrar");
      const rSin = await fetch(`${BASE}/api/citas/bookings/${b.cita.id}/confirm`, {
        method: "PATCH", headers: authHeaders, body: JSON.stringify({ sinCobrar: true }),
      });
      esperar(rSin.status === 200, `deja confirmarla a mano (es ${rSin.status})`);
      await b.cita.reload();
      esperar(b.cita.status === "confirmed", `la cita queda confirmada (es '${b.cita.status}')`);
      esperar(b.cita.paymentStatus === "void", `sin cobro, para cobrar en consulta (es '${b.cita.paymentStatus}')`);
    }

    // ── 6. Rechazar suelta el dinero ─────────────────────────────────────────
    paso("6. La profesional RECHAZA → se suelta la retención");
    const c = await solicitudConTarjetaRetenida(7);
    if (c) {
      const rr = await fetch(`${BASE}/api/citas/bookings/${c.cita.id}/reject`, {
        method: "PATCH", headers: authHeaders,
        body: JSON.stringify({ cancellationReason: "No hay hueco esa semana" }),
      });
      esperar(rr.status === 200, `rechaza con 200 (es ${rr.status})`);
      await c.cita.reload();
      esperar(c.cita.status === "cancelled", `la cita queda cancelada (es '${c.cita.status}')`);
      esperar(c.cita.paymentStatus === "void", `y sin retención (es '${c.cita.paymentStatus}')`);
      const piC = await stripe.paymentIntents.retrieve(c.ps.stripePaymentIntentId);
      esperar(piC.status === "canceled", `en Stripe el dinero está suelto (es '${piC.status}')`);
      esperar(piC.amount_received === 0, `y no se cobró nada (${piC.amount_received})`);
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
    fallos === 0 ? "\n✓ TODO CORRECTO — confirmar cobra, rechazar suelta, y sin dinero no se confirma\n\n"
                 : `\n✗ ${fallos} comprobaciones fallidas\n\n`
  );
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write(`\n✗ ${e?.message ?? e}\n${e?.stack ?? ""}\n\n`);
  process.exit(1);
});
