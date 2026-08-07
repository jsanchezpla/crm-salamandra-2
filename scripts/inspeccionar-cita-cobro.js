/**
 * inspeccionar-cita-cobro.js — radiografía de una cita con cobro problemático.
 *
 * SOLO LECTURA. No toca la cita, no toca Stripe, no manda nada.
 *
 * EL PROBLEMA QUE RESUELVE
 * Cuando una clienta pregunta "¿por qué me ha llegado esto del cobro?", hay que
 * poder responder con hechos y no con hipótesis. Este script junta en una sola
 * pasada las cuatro fuentes que cuentan la historia completa de una cita:
 *   1. la fila del Booking — incluido `cancellationReason`, que viaja LITERAL
 *      en el email de cancelación al cliente;
 *   2. sus payment_sessions — cada intento de retención, con su PaymentIntent;
 *   3. Stripe — el estado REAL del dinero (¿sigue retenido en la tarjeta?);
 *   4. la auditoría de master — quién pulsó qué y cuándo.
 *
 * NO imprime ninguna clave ni secreto: de Stripe solo salen estados e
 * identificadores de PaymentIntent, que no sirven para operar sin la clave.
 *
 * USO
 *   node --env-file=.env.local scripts/inspeccionar-cita-cobro.js <slug> <búsqueda>
 *   docker exec crm-salamandra-app-1 node scripts/inspeccionar-cita-cobro.js nutri_laura "Inés Chico"
 *
 * <búsqueda> casa contra clientName y clientEmail (ILIKE). Máximo 10 citas.
 */

import { Op } from "sequelize";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { getStripe, getTenantStripeConfig } from "../lib/payments/stripeConfig.js";

const SLUG = process.argv[2];
const BUSQUEDA = process.argv[3];

const w = (s) => process.stdout.write(s);
const eur = (cents) =>
  Number.isInteger(cents) ? (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" }) : "—";
const f = (d) => (d ? new Date(d).toLocaleString("es-ES", { timeZone: "Europe/Madrid" }) : "—");

async function main() {
  if (!SLUG || !BUSQUEDA) {
    w("\nUso: inspeccionar-cita-cobro.js <slug> <texto a buscar en nombre/email del cliente>\n\n");
    process.exit(1);
  }

  getMasterDb();
  const { Tenant, User, AuditLog } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) {
    w(`\nNo existe el tenant "${SLUG}".\n\n`);
    process.exit(1);
  }

  const { models } = getTenantDb(SLUG);
  const { Booking, EventType, PaymentSession } = models;
  const ctx = { slug: SLUG, tenant, tenantModels: models };

  w(`\n${"═".repeat(74)}\n  Cita y cobro · ${tenant.name} (${SLUG}) · búsqueda: "${BUSQUEDA}"\n${"═".repeat(74)}\n`);

  // Interruptores relevantes del tenant (NUNCA settings.integrations: ahí viven claves)
  const citasCfg = tenant.settings?.citas ?? {};
  w(`  agendaCompartida: ${citasCfg.agendaCompartida === true} · avisosWhatsapp: ${citasCfg.avisosWhatsapp === true}\n`);

  const bookings = await Booking.findAll({
    where: {
      [Op.or]: [
        { clientName: { [Op.iLike]: `%${BUSQUEDA}%` } },
        { clientEmail: { [Op.iLike]: `%${BUSQUEDA}%` } },
      ],
    },
    include: [{ model: EventType, as: "eventType" }],
    order: [["scheduledAt", "DESC"]],
    limit: 10,
  });

  if (!bookings.length) {
    w(`\n  Ninguna cita casa con "${BUSQUEDA}".\n\n`);
    process.exit(0);
  }

  const stripe = getTenantStripeConfig(ctx).secretKey ? await getStripe(ctx) : null;
  if (!stripe) w("  ! Sin clave de Stripe en el tenant: no se podrá preguntar el estado real del dinero.\n");

  for (const b of bookings) {
    w(`\n${"─".repeat(74)}\n`);
    w(`  ${b.clientName} <${b.clientEmail ?? "sin email"}> · ${b.eventType?.name ?? "sin servicio"}\n`);
    w(`  Cita: ${f(b.scheduledAt)} · creada: ${f(b.createdAt)} · id ${b.id}\n`);
    w(`  status: ${b.status} · paymentStatus: ${b.paymentStatus} · importe: ${eur(b.amount)}\n`);
    if (b.cancelledAt || b.cancellationReason) {
      w(`  cancelledAt: ${f(b.cancelledAt)}\n`);
      // Este texto es el que viajó LITERAL en el email "Tu cita ha sido cancelada"
      w(`  cancellationReason: ${b.cancellationReason ? JSON.stringify(b.cancellationReason) : "(vacío — el email fue sin motivo)"}\n`);
    }

    // ── Intentos de cobro ─────────────────────────────────────────────────
    const sesiones = await PaymentSession.findAll({
      where: { entityType: "booking", entityId: b.id },
      order: [["createdAt", "ASC"]],
    });
    if (!sesiones.length) w(`  (sin payment_sessions: nunca hubo retención)\n`);

    for (const ps of sesiones) {
      w(`\n  · PaymentSession ${ps.id} (${f(ps.createdAt)})\n`);
      w(`    status: ${ps.status} · ${eur(ps.amount)} · descripción: ${ps.description ?? "—"}\n`);
      w(`    caduca: ${f(ps.authorizationExpiresAt)} · pagada: ${f(ps.paidAt)}\n`);
      const meta = ps.metadata ?? {};
      const metaSinRuido = Object.fromEntries(Object.entries(meta).filter(([k]) => k !== "paymentSessionId"));
      if (Object.keys(metaSinRuido).length) w(`    metadata: ${JSON.stringify(metaSinRuido)}\n`);

      if (ps.stripePaymentIntentId && stripe) {
        try {
          const pi = await stripe.paymentIntents.retrieve(ps.stripePaymentIntentId, {
            expand: ["latest_charge"],
          });
          const charge = pi.latest_charge;
          w(`    Stripe ${pi.id}: estado ${pi.status}`);
          if (pi.status === "requires_capture") {
            const cad = charge?.payment_method_details?.card?.capture_before;
            w(` ⚠️  EL DINERO SIGUE RETENIDO EN LA TARJETA (caduca ${cad ? f(cad * 1000) : "¿?"})`);
          }
          if (pi.status === "canceled") w(` · liberado (${pi.cancellation_reason ?? "sin motivo"}, ${f(pi.canceled_at * 1000)})`);
          if (pi.status === "succeeded") w(` · cobrado ${eur(pi.amount_received)}`);
          w(`\n`);
          if (charge?.outcome && charge.status !== "succeeded") {
            // Qué dijo el banco exactamente (esto no se le enseña nunca al cliente)
            w(`    banco: ${charge.outcome.type ?? "?"} / ${charge.outcome.seller_message ?? "?"} (code ${charge.failure_code ?? "—"})\n`);
          }
        } catch (err) {
          w(`    Stripe ${ps.stripePaymentIntentId}: no se pudo consultar (${err.message})\n`);
        }
      }
    }

    // ── Quién hizo qué (auditoría de master) ──────────────────────────────
    const eventos = await AuditLog.findAll({
      where: { tenantId: tenant.id, entity: "Booking", entityId: b.id },
      order: [["createdAt", "ASC"]],
    });
    if (eventos.length) {
      w(`\n  Auditoría:\n`);
      for (const ev of eventos) {
        let quien = "(sistema/anónimo)";
        if (ev.userId) {
          const u = await User.findByPk(ev.userId);
          quien = u?.email ?? ev.userId;
        }
        w(`    ${f(ev.createdAt)} · ${ev.action} · ${quien}\n`);
        if (ev.before) w(`      before: ${JSON.stringify(ev.before)}\n`);
        if (ev.after) w(`      after:  ${JSON.stringify(ev.after)}\n`);
      }
    } else {
      w(`\n  Auditoría: sin entradas para esta cita.\n`);
    }
  }

  w(`\n${"═".repeat(74)}\n\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err.stack || err.message}\n`);
  process.exit(1);
});
