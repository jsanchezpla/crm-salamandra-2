/**
 * lib/billing/cobroDesdeStripe.js — el dinero online cruza a Facturación.
 *
 * QUÉ RESUELVE (medido en producción el 24/08/2026): un pago de Stripe quedaba
 * anotado en `payment_sessions` y AHÍ SE ACABABA — la pantalla de Cobros no lo
 * veía, el total del mes no lo sumaba y la morosidad lo daba por impagado. Los
 * cobros del módulo Facturación solo los creaba el formulario, a mano. Desde
 * hoy, cuando el webhook confirma un pago, el cobro se registra solo, con la
 * referencia de Stripe puesta — que es lo que hace posible el botón «Ver en
 * Stripe» de la pantalla de Cobros.
 *
 * ── LO QUE ESTO NO HACE, Y ES DELIBERADO ────────────────────────────────────
 *   · No genera factura (la decisión de 2026-07-27 sigue: cobrar no factura).
 *   · No toca al tenant sin `billing`: sin módulo de Facturación no hay libro
 *     de cobros donde apuntar, y no pasa nada — la sesión de pago sigue siendo
 *     la verdad del cobro online.
 *   · Las CUOTAS de un fraccionado (2ª en adelante) no crean cobros nuevos: su
 *     rastro vive en `ps.metadata.cuotasPagadas` y crearles fila exigiría otra
 *     idempotencia. Si algún día hace falta, es un sprint, no un parche aquí.
 *
 * Corre DENTRO de la transacción del webhook (todo con `{ transaction: t }`);
 * la auditoría va en `postCommit`, como los correos de entityHooks.
 */

import { logBillingAudit, resumenImporte } from "./audit.js";

/** El cliente al que pertenece el cobro, según qué entidad se pagó. */
async function clienteDeLaEntidad(ctx, paymentSession, t) {
  const { Booking, Order } = ctx.tenantModels;
  try {
    if (paymentSession.entityType === "booking" && Booking) {
      const cita = await Booking.findByPk(paymentSession.entityId, {
        attributes: ["id", "clientId"],
        transaction: t,
      });
      return cita?.clientId ?? null;
    }
    if (paymentSession.entityType === "order" && Order) {
      const pedido = await Order.findByPk(paymentSession.entityId, {
        attributes: ["id", "clientId"],
        transaction: t,
      });
      return pedido?.clientId ?? null;
    }
  } catch {
    // Sin cliente el cobro se registra igual: es dinero de verdad. La pantalla
    // lo enseña con «—» y se le puede poner cliente editándolo.
  }
  return null;
}

/**
 * Registra en Facturación el cobro de una sesión de pago YA pagada.
 *
 * Idempotente por partida doble: se busca antes por `paymentSessionId`, y la
 * columna es UNIQUE en base de datos — Stripe reintenta los webhooks hasta 3
 * días y un reintento no puede duplicar dinero.
 *
 * Devuelve `{ outcome, postCommit? }` o `null` si aquí no hay nada que hacer.
 */
export async function registrarCobroDeSesion(ctx, paymentSession, t) {
  if (typeof ctx.hasModule !== "function" || !ctx.hasModule("billing")) return null;
  const { Payment } = ctx.tenantModels;
  if (!Payment) return null;

  const existente = await Payment.findOne({
    where: { paymentSessionId: paymentSession.id },
    transaction: t,
  });
  if (existente) {
    // Reintento o segundo evento del mismo cobro: como mucho se le completa la
    // referencia de Stripe si el primer evento llegó sin ella.
    if (!existente.stripePaymentIntentId && paymentSession.stripePaymentIntentId) {
      await existente.update(
        { stripePaymentIntentId: paymentSession.stripePaymentIntentId },
        { transaction: t }
      );
    }
    return { outcome: "el cobro ya estaba en Facturación" };
  }

  const clientId = await clienteDeLaEntidad(ctx, paymentSession, t);
  const euros = Math.round(Number(paymentSession.amount)) / 100; // la sesión va en céntimos

  const payment = await Payment.create(
    {
      invoiceId: null,
      clientId,
      periodMonth: null,
      amount: euros,
      paidAt: paymentSession.paidAt ?? new Date(),
      method: "card",
      status: "completed",
      notes: paymentSession.description
        ? `Cobro online (Stripe): ${paymentSession.description}`.slice(0, 500)
        : "Cobro online (Stripe)",
      paymentSessionId: paymentSession.id,
      stripePaymentIntentId: paymentSession.stripePaymentIntentId ?? null,
    },
    { transaction: t }
  );

  return {
    outcome: `cobro de ${euros.toFixed(2)} € registrado en Facturación`,
    // La auditoría, DESPUÉS de la mutación y FUERA de la transacción, como
    // manda la regla. Sin userId: aquí no hay persona, hay un webhook.
    postCommit: async () => {
      await logBillingAudit({
        tenantId: ctx.tenant.id,
        userId: null,
        action: "payment.created",
        entity: "Payment",
        entityId: payment.id,
        before: null,
        after: resumenImporte(payment),
      });
    },
  };
}

/**
 * Envuelve el resultado de un handler del webhook añadiéndole el registro del
 * cobro: junta los `outcome` y encadena los `postCommit`. Si aquí no había nada
 * que registrar (sin billing), devuelve el resultado original tal cual.
 */
export async function conCobroRegistrado(ctx, paymentSession, t, resultado) {
  const cobro = await registrarCobroDeSesion(ctx, paymentSession, t);
  if (!cobro) return resultado;

  const outcomePrevio = typeof resultado === "string" ? resultado : (resultado?.outcome ?? "ok");
  const postPrevio = typeof resultado === "string" ? null : (resultado?.postCommit ?? null);
  const posts = [postPrevio, cobro.postCommit].filter(Boolean);

  return {
    outcome: `${outcomePrevio} · ${cobro.outcome}`,
    ...(posts.length
      ? {
          postCommit: async () => {
            for (const p of posts) await p();
          },
        }
      : {}),
  };
}

/**
 * La devolución también cruza: si el cobro de esa sesión estaba en Facturación,
 * pasa a `refunded` para que el total del mes no cuente dinero devuelto.
 */
export async function marcarCobroDevuelto(ctx, paymentSession, t) {
  if (typeof ctx.hasModule !== "function" || !ctx.hasModule("billing")) return null;
  const { Payment } = ctx.tenantModels;
  if (!Payment) return null;

  const payment = await Payment.findOne({
    where: { paymentSessionId: paymentSession.id },
    transaction: t,
  });
  if (!payment || payment.status === "refunded") return null;

  await payment.update({ status: "refunded" }, { transaction: t });
  return { outcome: "el cobro de Facturación pasa a devuelto" };
}

/**
 * La página de ESE cobro en el panel de Stripe. Prueba y producción tienen
 * paneles distintos; se decide por el modo de la clave del tenant, que es el
 * mismo dato que ya usa la tarjeta de Configuración (no puede desincronizarse).
 */
export function urlPanelStripe(liveMode, paymentIntentId) {
  if (!paymentIntentId) return null;
  return `https://dashboard.stripe.com/${liveMode ? "" : "test/"}payments/${encodeURIComponent(paymentIntentId)}`;
}
