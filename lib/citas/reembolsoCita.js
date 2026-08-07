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
 * acabaría faltando en alguno.
 *
 * ── BEST-EFFORT A PROPÓSITO ─────────────────────────────────────────────────
 * Cancelar NUNCA debe fallar porque Stripe no conteste: el paciente tiene
 * derecho a cancelar aunque la pasarela esté caída. Si la devolución falla, la
 * cita queda cancelada y el cobro sigue marcado 'paid'; esa combinación
 * (status 'cancelled' + paymentStatus 'paid') es exactamente la consulta que
 * localiza el dinero pendiente de devolver.
 */

import { decidirReembolso } from "./politicaReembolso.js";
import { soltarRetencionDeCita, tieneRetencionPendiente } from "./cobroCita.js";

/**
 * @param {object} ctx       tenantContext (necesita tenantModels y las claves de Stripe)
 * @param {object} booking   fila Booking YA cancelada
 * @param {object} opts
 * @param {"cliente"|"profesional"|"no_show"} opts.quienCancela
 * @returns {Promise<{ reembolsado: boolean, importe: number, motivo: string, tipo?: string, error?: string }>}
 */
export async function reembolsarCitaSiProcede(ctx, booking, { quienCancela }) {
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
   * ⚠️ AQUÍ SE ACABA. El CRM no devuelve dinero automáticamente (07/08/2026,
   * Rodrigo): la política vive en `politicaReembolso.js` y hoy dice que no,
   * siempre. Lo que se cancela es una SESIÓN, no la compra; el importe se queda
   * y la consulta decide qué hacer con él — si toca devolver algo, se hace a
   * mano desde Stripe, donde se ve el cobro entero y quien lo hace responde.
   *
   * El código que llamaba a Stripe se ha BORRADO, no comentado ni apagado con
   * un flag: media política es la que acaba devolviendo dinero el día que
   * alguien toca el interruptor sin querer. Si vuelve a hacer falta, se
   * recupera del historial (commit del 07/08/2026) junto con su porqué.
   *
   * Lo de arriba —soltar una retención— SÍ sigue: retener no es cobrar, y
   * dejarle el dinero congelado a alguien por una cita que no va a existir no
   * es «no devolver», es retenerlo sin motivo.
   */
  const decision = decidirReembolso({ paymentStatus: booking.paymentStatus });
  return { reembolsado: false, importe: 0, motivo: decision.motivo };
}
