/**
 * Aplica la política de reembolso a una cita que se acaba de cancelar.
 *
 * Existe para que NINGUNA vía de cancelación pueda olvidarse del dinero. Hay
 * cuatro (enlace del email, portal del paciente, rechazo desde el panel y PATCH
 * de admin) y hasta ahora ninguna devolvía nada: la cita quedaba cancelada,
 * `paymentStatus` seguía en 'paid' y el paciente perdía su dinero sin que nadie
 * se enterara.
 *
 * ── BEST-EFFORT A PROPÓSITO ─────────────────────────────────────────────────
 * Cancelar NUNCA debe fallar porque Stripe no conteste: el paciente tiene
 * derecho a cancelar aunque la pasarela esté caída. Si la devolución falla, la
 * cita queda cancelada y el cobro sigue marcado 'paid'; esa combinación
 * (status 'cancelled' + paymentStatus 'paid') es exactamente la consulta que
 * localiza el dinero pendiente de devolver.
 */

import { decidirReembolso } from "./politicaReembolso.js";
import { refundPayment } from "../payments/refund.js";

/**
 * @param {object} ctx       tenantContext (necesita tenantModels y las claves de Stripe)
 * @param {object} booking   fila Booking YA cancelada
 * @param {object} opts
 * @param {"cliente"|"profesional"|"no_show"} opts.quienCancela
 * @returns {Promise<{ reembolsado: boolean, importe: number, motivo: string, error?: string }>}
 */
export async function reembolsarCitaSiProcede(ctx, booking, { quienCancela }) {
  const decision = decidirReembolso({
    quienCancela,
    scheduledAt: booking.scheduledAt,
    paymentStatus: booking.paymentStatus,
    amount: booking.amount,
  });

  if (!decision.reembolsar) {
    return { reembolsado: false, importe: 0, motivo: decision.motivo };
  }

  const { PaymentSession } = ctx.tenantModels ?? {};
  if (!PaymentSession) {
    return { reembolsado: false, importe: 0, motivo: decision.motivo, error: "sin modelo PaymentSession" };
  }

  // El cobro de esta cita. Se coge el más reciente que conste pagado: si hubo
  // intentos fallidos antes, no son el que hay que devolver.
  const ps = await PaymentSession.findOne({
    where: { entityType: "booking", entityId: booking.id, status: "paid" },
    order: [["createdAt", "DESC"]],
  });

  if (!ps) {
    process.stderr.write(
      `[pagos] REEMBOLSO IMPOSIBLE — tenant ${ctx.slug}, cita ${booking.id}: consta pagada pero no se encuentra su cobro. Revisar a mano.\n`
    );
    return { reembolsado: false, importe: 0, motivo: decision.motivo, error: "no se encontró el cobro" };
  }

  try {
    // Si la política pide devolución ÍNTEGRA no se le pasa importe: que
    // `refundPayment` calcule lo que QUEDA. Pasarle el total de la cita revienta
    // cuando ya hubo una devolución parcial —por ejemplo hecha a mano desde el
    // panel de Stripe—, porque pediríamos 63 € de los 43 € que quedan; el
    // reembolso se rechaza y el paciente se queda sin el resto de su dinero.
    const integro = decision.importe >= (booking.amount ?? 0);
    const res = await refundPayment(ctx, ps, {
      ...(integro ? {} : { amount: decision.importe }),
      reason: decision.motivo,
    });
    // La cita solo deja de estar pagada si ya no queda dinero por devolver.
    await booking.update({ paymentStatus: ps.status === "refunded" ? "refunded" : "paid" });
    return { reembolsado: true, importe: res.amount, motivo: decision.motivo };
  } catch (err) {
    // El dinero sigue en Stripe. La cita queda cancelada y 'paid', que es la
    // señal de "hay que devolver esto".
    process.stderr.write(
      `[pagos] REEMBOLSO FALLIDO — tenant ${ctx.slug}, cita ${booking.id}, cobro ${ps.id}: ${err.message}. Queda pendiente de devolver.\n`
    );
    return { reembolsado: false, importe: 0, motivo: decision.motivo, error: err.message };
  }
}
