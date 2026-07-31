/**
 * El dinero de una cita: cobrarlo al confirmar, soltarlo al rechazar.
 *
 * Envuelve `lib/payments/autorizacion.js` traduciendo sus resultados al mundo de
 * las citas (qué queda escrito en el Booking, qué se le dice a la profesional).
 * Vive aquí y no repetido en cada ruta porque son TRES los sitios que sueltan
 * dinero —rechazar, cancelar desde el panel y cancelar desde el portal— y si
 * cada uno lo hiciera a su manera acabarían divergiendo justo donde no se puede.
 *
 * ── LA REGLA DE ORO ──────────────────────────────────────────────────────────
 * SI NO HAY DINERO, LA CITA NO SE CONFIRMA Y AL PACIENTE NO LE LLEGA NINGÚN
 * CORREO DE CONFIRMACIÓN. Nunca un "tu cita está confirmada" sobre un cobro que
 * no cuajó. Por eso `cobrarCitaAlConfirmar` se llama ANTES de dar la cita por
 * confirmada, y no después.
 */

import {
  capturarPago,
  liberarAutorizacion,
} from "../payments/autorizacion.js";

/**
 * Estados en los que PUEDE haber dinero comprometido en Stripe pendiente de
 * resolver — capturarlo o soltarlo.
 *
 * ── POR QUÉ ESTÁ 'failed' AQUÍ (revisión adversarial 2026-07-30) ─────────────
 * Que una captura sea rechazada NO significa que el dinero haya desaparecido:
 * el PaymentIntent puede seguir perfectamente en `requires_capture`. Al dejar
 * 'failed' fuera de esta lista pasaban dos cosas malas: "reintentar" (el botón
 * Confirmar) confirmaba la cita GRATIS y en silencio, y rechazarla no soltaba
 * nada, dejando el importe bloqueado en la tarjeta del paciente hasta caducar.
 *
 * La regla de esta lista es "hay que preguntarle a Stripe qué pasa con este
 * dinero", no "seguro que hay dinero". Preguntar de más es barato; darlo por
 * perdido, no.
 */
const PUEDE_HABER_DINERO = new Set(["authorized", "capturing", "failed"]);

/** ¿Hay dinero comprometido en Stripe que haya que capturar o soltar? */
export function tieneRetencionPendiente(booking) {
  return PUEDE_HABER_DINERO.has(booking?.paymentStatus);
}

/**
 * ¿Está el PACIENTE todavía metiendo la tarjeta?
 *
 * Es un estado distinto de "no hay dinero": lo habrá en segundos. Y es la
 * trampa más cara que tenía este flujo — la solicitud YA se ve en la lista de
 * espera durante esos veinte minutos, con su botón de Confirmar activo. Si la
 * profesional lo pulsaba justo entonces, la cita se confirmaba sin cobrar; y
 * cuando el paciente terminaba, el webhook escribía 'authorized' encima de una
 * cita ya confirmada. Ese par no lo captura nadie: la cita se daba, el dinero
 * se quedaba bloqueado siete días en su tarjeta y luego se evaporaba. Encima
 * recibía dos correos que se contradecían.
 */
export function estaEsperandoAlPaciente(booking) {
  return booking?.paymentStatus === "authorizing";
}

/**
 * Captura el dinero retenido de una cita.
 *
 * Devuelve SIEMPRE un objeto, nunca lanza: quien confirma necesita saber qué ha
 * pasado para decidir, no un error que tumbe la petición.
 *
 * @returns {Promise<{cobrado: boolean, importe?: number, code?: string, mensaje?: string}>}
 *   · `{cobrado: true}`  → hay dinero; se puede confirmar
 *   · `{cobrado: false}` → NO se puede confirmar cobrando. `code` dice por qué:
 *       CADUCADA      la retención murió; hay que pedir otra tarjeta o confirmar sin cobrar
 *       RECHAZADA     el banco dijo que no
 *       SIN_RETENCION nunca llegó a retenerse
 */
export async function cobrarCitaAlConfirmar(ctx, booking) {
  const { PaymentSession } = ctx.tenantModels;

  if (!tieneRetencionPendiente(booking)) {
    return { cobrado: false, code: "SIN_RETENCION", mensaje: "Esta cita no tiene ningún importe retenido" };
  }

  const ps = booking.paymentSessionId
    ? await PaymentSession.findByPk(booking.paymentSessionId)
    : await PaymentSession.findOne({
        where: { entityType: "booking", entityId: booking.id },
        order: [["createdAt", "DESC"]],
      });
  if (!ps) {
    return { cobrado: false, code: "SIN_RETENCION", mensaje: "No se encuentra el cobro de esta cita" };
  }

  try {
    const { importe } = await capturarPago(ctx, ps, { porQuien: ctx.user?.id ?? null });
    await booking.update({ paymentStatus: "paid", holdExpiresAt: null });
    return { cobrado: true, importe };
  } catch (err) {
    // Capturado dos veces: no es un fallo. Alguien se adelantó (o Stripe
    // reintentó) y el dinero está donde tiene que estar.
    if (err?.code === "YA_CAPTURADO") {
      await booking.update({ paymentStatus: "paid", holdExpiresAt: null });
      return { cobrado: true, importe: booking.amount ?? null, code: "YA_CAPTURADO" };
    }

    if (err?.code === "CADUCADA") {
      // La retención murió sola. La cita NO se toca: sigue siendo una solicitud
      // válida de una persona real, y quien decide qué hacer es la profesional.
      await booking.update({ paymentStatus: "void", authorizationExpiresAt: null });
      return {
        cobrado: false,
        code: "CADUCADA",
        mensaje:
          "La reserva de la tarjeta ha caducado. Pídele al paciente que la introduzca de nuevo, o confirma la cita sin cobrar y cóbrale en consulta.",
      };
    }

    // Rechazo del banco. Se deja en 'failed' para que se vea en la lista de
    // espera; el PaymentIntent puede seguir vivo y admitir reintento.
    await booking.update({ paymentStatus: "failed" });
    return {
      cobrado: false,
      code: err?.code ?? "RECHAZADA",
      // Nunca se le enseña al paciente el motivo real de una tarjeta perdida o
      // robada; a la profesional se le da el mensaje de Stripe, que es quien
      // tiene que decidir, pero sin volcarlo a ninguna pantalla pública.
      mensaje: "El banco ha rechazado el cobro. Prueba a reintentarlo o pídele otra tarjeta al paciente.",
    };
  }
}

/**
 * Suelta el dinero retenido de una cita sin cobrar nada.
 *
 * NO es un reembolso: no hubo cobro, así que no hay comisión ni movimiento que
 * devolver. Es best-effort a propósito — que Stripe no responda no puede impedir
 * que la profesional rechace una solicitud. Si falla, la retención caduca sola
 * en unos días; mientras tanto queda el aviso en el log.
 *
 * @returns {Promise<{soltado: boolean, motivo?: string}>}
 */
export async function soltarRetencionDeCita(ctx, booking, motivo = null) {
  const { PaymentSession } = ctx.tenantModels;

  if (!tieneRetencionPendiente(booking)) return { soltado: false, motivo: "no había retención" };

  const ps = booking.paymentSessionId
    ? await PaymentSession.findByPk(booking.paymentSessionId)
    : await PaymentSession.findOne({
        where: { entityType: "booking", entityId: booking.id },
        order: [["createdAt", "DESC"]],
      });
  if (!ps) return { soltado: false, motivo: "no se encontró el cobro" };

  try {
    await liberarAutorizacion(ctx, ps, { motivo, razonStripe: "requested_by_customer" });
    await booking.update({ paymentStatus: "void", holdExpiresAt: null, authorizationExpiresAt: null });
    return { soltado: true };
  } catch (err) {
    if (err?.code === "YA_CAPTURADO") {
      // El dinero ya se cobró: esto no se suelta, se devuelve. Quien llame tiene
      // que usar la vía de reembolso.
      return { soltado: false, motivo: "ya estaba cobrada — hay que devolver, no soltar" };
    }
    process.stderr.write(
      `[citas] no se pudo soltar la retención de la cita ${booking.id} (${ctx.slug}): ${err.message}\n`
    );
    return { soltado: false, motivo: err.message };
  }
}
