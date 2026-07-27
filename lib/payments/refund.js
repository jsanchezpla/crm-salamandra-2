/**
 * Reembolsos.
 *
 * La API de reembolso de Stripe es la MISMA sea cual sea el método con el que se
 * pagó (tarjeta, Klarna, Bizum…). Por eso aquí no hay ninguna rama por método: si
 * el tenant activa Klarna mañana en su panel, esto sigue funcionando igual.
 *
 * Idempotencia: la clave de idempotencia se deriva del id de la PaymentSession, de
 * modo que dos llamadas concurrentes (p. ej. el cliente cancela mientras el admin
 * cancela) no producen dos devoluciones.
 */

import { ValidationError } from "../utils/errors.js";
import { getStripe } from "./stripeConfig.js";

/**
 * Reembolsa una PaymentSession pagada.
 *
 * @param {object} ctx
 * @param {object} paymentSession  fila Sequelize de PaymentSession
 * @param {object} [opts]
 * @param {number} [opts.amount]   céntimos a devolver; por defecto TODO
 * @param {string} [opts.reason]   motivo interno (se guarda, no va a Stripe)
 * @returns {Promise<{ ok: true, refundId: string, amount: number }>}
 */
export async function refundPayment(ctx, paymentSession, opts = {}) {
  if (!paymentSession) throw new ValidationError("No hay pago que reembolsar");

  // Ya devuelto: no-op idempotente. Que dos vías de cancelación pidan el reembolso
  // no debe producir dos devoluciones.
  if (paymentSession.status === "refunded") {
    return { ok: true, refundId: paymentSession.stripeRefundId, amount: paymentSession.refundAmount ?? 0 };
  }
  if (paymentSession.status !== "paid") {
    throw new ValidationError("Solo se puede reembolsar un pago completado");
  }
  if (!paymentSession.stripePaymentIntentId) {
    throw new ValidationError("El pago no tiene referencia de Stripe; reembolso manual");
  }

  // Lo ya devuelto en llamadas anteriores. Validar solo contra el total permitiría
  // devolver 60 € y luego otros 60 € de un cobro de 100 €: dos importes válidos por
  // separado que suman más de lo cobrado. Se valida contra lo QUE QUEDA.
  const yaDevuelto = paymentSession.refundAmount ?? 0;
  const restante = paymentSession.amount - yaDevuelto;
  const amount = Number.isInteger(opts.amount) ? opts.amount : restante;
  if (!Number.isInteger(amount) || amount <= 0 || amount > restante) {
    throw new ValidationError(
      `Importe de reembolso inválido (quedan ${restante} céntimos por devolver)`
    );
  }

  const stripe = await getStripe(ctx);
  if (!stripe) throw new ValidationError("El tenant no tiene Stripe configurado");

  const refund = await stripe.refunds.create(
    {
      payment_intent: paymentSession.stripePaymentIntentId,
      amount,
      metadata: { paymentSessionId: paymentSession.id, tenantSlug: ctx.slug },
    },
    // La clave incluye lo ya devuelto: dos devoluciones parciales legítimas del
    // mismo importe (50 € y otros 50 €) son operaciones DISTINTAS y deben pasar
    // las dos; solo un reintento de la misma debe deduplicarse.
    { idempotencyKey: `refund:${paymentSession.id}:${yaDevuelto}:${amount}` }
  );

  const totalDevuelto = yaDevuelto + amount;
  await paymentSession.update({
    // Un reembolso parcial NO deja el pago como "devuelto": sigue habiendo dinero
    // cobrado. Solo se marca 'refunded' cuando ya se devolvió todo.
    status: totalDevuelto === paymentSession.amount ? "refunded" : "paid",
    stripeRefundId: refund.id,
    refundAmount: totalDevuelto,
    refundedAt: new Date(),
    refundReason: opts.reason ?? null,
  });

  return { ok: true, refundId: refund.id, amount };
}
