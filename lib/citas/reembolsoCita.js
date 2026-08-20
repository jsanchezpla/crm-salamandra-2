/**
 * Deja resuelto el dinero de una cita que se acaba de cancelar.
 *
 * Existe para que NINGUNA vía de cancelación pueda olvidarse del dinero. Hay
 * cuatro (enlace del email, portal del paciente, rechazo desde el panel y PATCH
 * de admin) y hasta ahora ninguna devolvía nada: la cita quedaba cancelada,
 * `paymentStatus` seguía en 'paid' y el paciente perdía su dinero sin que nadie
 * se enterara.
 *
 * ── DOS FORMAS DE DINERO, Y SOLO SE CONTEMPLABA UNA ──────────────────────────
 * Desde el sprint de retención hay citas con dinero RETENIDO pero NO COBRADO.
 * Eso no se devuelve —no hay nada que devolver—, se SUELTA. Y la política de
 * reembolso ni siquiera llegaba a mirarlas: `decidirReembolso` corta en su
 * primera puerta si `paymentStatus !== 'paid'`, así que devolvía "no hay cobro
 * que reembolsar" y se quedaba tan ancha. Resultado: el paciente con el dinero
 * bloqueado en su tarjeta hasta que la retención caducara sola, días después.
 *
 * Por eso la decisión de QUÉ tipo de dinero hay se toma AQUÍ y no en cada
 * llamante: los cuatro caminos pasan por esta función, y si se decidiera fuera
 * acabaría faltando en alguno. El orden importa y no se puede invertir: primero
 * la retención (soltar), y solo con el dinero ya cobrado se pregunta si se
 * devuelve.
 *
 * ── QUIÉN DEVUELVE, DESDE EL 20/08/2026 ─────────────────────────────────────
 * La regla sigue siendo que no se devuelve al cancelar, con UNA excepción con
 * nombre en `politicaReembolso.js`: haberle cobrado a alguien una cita que ya
 * estaba cancelada. Quien la invoca la pasa en `motivo`; los demás llamantes no
 * pasan nada y no devuelven nada.
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
import { soltarRetencionDeCita, tieneRetencionPendiente } from "./cobroCita.js";

/**
 * @param {object} ctx       tenantContext (necesita tenantModels y las claves de Stripe)
 * @param {object} booking   fila Booking YA cancelada
 * @param {object} opts
 * @param {"cliente"|"profesional"|"no_show"} opts.quienCancela
 * @param {string} [opts.motivo]  motivo con nombre de `politicaReembolso.js`; sin
 *   él rige la regla general (no se devuelve)
 * @returns {Promise<{ reembolsado: boolean, importe: number, motivo: string, tipo?: string, error?: string }>}
 */
export async function reembolsarCitaSiProcede(ctx, booking, { quienCancela, motivo = null }) {
  /*
   * ── UN BONO NO SE DEVUELVE POR CANCELAR UNA DE SUS SESIONES ────────────────
   * (06/08/2026, Rodrigo: «si la nutricionista rechaza la cita, no significa
   * que cancele el pedido, significa que cancela la cita para reasignarla».)
   *
   * Lo que se pagó en un bono es el PROGRAMA —diez sesiones, el acompañamiento
   * del mes—, no la hora concreta del jueves. Devolver ese dinero porque la
   * profesional mueva una sesión sería deshacer la compra entera por reordenar
   * la agenda: la paciente se quedaría sin programa sin haberlo pedido.
   *
   * La sesión no se pierde: las sesiones gastadas no son un contador, se cuentan
   * desde las propias citas (ver `estadoPack`), así que una cita cancelada
   * vuelve a estar disponible sola y se puede dar otra fecha.
   *
   * Esto NO deja a nadie sin su dinero: devolver un bono es una decisión de la
   * consulta —se hace desde Facturación, con su importe y su motivo— y no algo
   * que deba dispararse por mover una hora.
   */
  if (booking?.packId) {
    return {
      reembolsado: false,
      tipo: "bono",
      importe: 0,
      motivo: "La sesión vuelve al bono: el programa sigue comprado y se puede dar otra fecha",
    };
  }

  // ── Dinero solo RETENIDO: se suelta, no se devuelve ───────────────────────
  // No depende de quién cancele ni de la antelación: no ha habido cobro, así que
  // no hay nada que repartir. Quedarse el dinero de alguien a quien no se le ha
  // dado la cita no es una política, es un error.
  if (tieneRetencionPendiente(booking)) {
    const r = await soltarRetencionDeCita(ctx, booking, `Cita cancelada (${quienCancela})`);
    return {
      reembolsado: false,
      tipo: "retencion",
      importe: 0,
      motivo: r.soltado
        ? "No había cobro: se ha liberado la reserva de la tarjeta"
        : `No se pudo liberar la reserva de la tarjeta: ${r.motivo ?? "motivo desconocido"}`,
      ...(r.soltado ? {} : { error: r.motivo }),
    };
  }

  /*
   * ── Dinero YA COBRADO: decide la política, y casi siempre dice que no ──────
   * El CRM no devuelve al cancelar (07/08/2026, Rodrigo): lo que se cancela es
   * una SESIÓN, no la compra; el importe se queda y la consulta decide qué
   * hacer con él a mano desde Stripe. La única excepción es el motivo con
   * nombre del 20/08/2026 —haberle cobrado a alguien una cita que ya estaba
   * cancelada—, y quien no lo pasa no devuelve nada.
   *
   * Por eso esto va DESPUÉS de la retención y nunca al revés: si el dinero solo
   * estaba reservado no hay nada que devolver, hay algo que soltar.
   */
  const decision = decidirReembolso({
    paymentStatus: booking.paymentStatus,
    amount: booking.amount,
    motivo,
  });
  if (!decision.reembolsar) {
    return { reembolsado: false, importe: 0, motivo: decision.motivo };
  }

  const { PaymentSession } = ctx.tenantModels ?? {};
  if (!PaymentSession) {
    return {
      reembolsado: false,
      tipo: "devolucion",
      importe: 0,
      motivo: "No se ha podido devolver el importe: hay que devolverlo a mano desde Stripe",
      error: "sin modelo PaymentSession",
    };
  }

  // El cobro de esta cita. Se coge el más reciente que conste pagado: si hubo
  // intentos fallidos antes, no son el que hay que devolver.
  const ps = await PaymentSession.findOne({
    where: { entityType: "booking", entityId: booking.id, status: "paid" },
    order: [["createdAt", "DESC"]],
  });
  if (!ps) {
    process.stderr.write(
      `[pagos] DEVOLUCIÓN IMPOSIBLE — tenant ${ctx.slug}, cita ${booking.id}: consta cobrada pero no se encuentra su cobro. Revisar a mano.\n`
    );
    return {
      reembolsado: false,
      tipo: "devolucion",
      importe: 0,
      motivo: "No se ha podido devolver el importe: hay que devolverlo a mano desde Stripe",
      error: "no se encontró el cobro",
    };
  }

  try {
    // Sin `amount`: que `refundPayment` calcule lo que QUEDA. Esta excepción es
    // íntegra, y pasarle el importe de la cita revienta cuando ya hubo una
    // devolución parcial hecha a mano desde el panel de Stripe, porque
    // pediríamos 63 € de los 43 € que quedan: el reembolso se rechaza y el
    // paciente se queda sin el resto de su dinero.
    const res = await refundPayment(ctx, ps, { reason: decision.motivo });
    // La cita solo deja de estar pagada si ya no queda dinero por devolver.
    await booking.update({ paymentStatus: ps.status === "refunded" ? "refunded" : "paid" });
    return {
      reembolsado: true,
      tipo: "devolucion",
      importe: res.amount,
      // Sin «íntegro»: si alguien ya devolvió una parte a mano, lo que ha vuelto
      // ahora es el resto. Devuelto está, y el importe exacto va al lado.
      motivo: "El importe se ha devuelto",
    };
  } catch (err) {
    // El dinero sigue en Stripe. La cita queda cancelada y 'paid', que es la
    // señal de "hay que devolver esto".
    process.stderr.write(
      `[pagos] DEVOLUCIÓN FALLIDA — tenant ${ctx.slug}, cita ${booking.id}, cobro ${ps.id}: ${err.message}. Queda pendiente de devolver.\n`
    );
    return {
      reembolsado: false,
      tipo: "devolucion",
      importe: 0,
      motivo: "No se ha podido devolver el importe: hay que devolverlo a mano desde Stripe",
      error: err.message,
    };
  }
}
