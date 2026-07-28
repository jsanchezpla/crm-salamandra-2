/**
 * Qué hacer cuando una entidad queda pagada o reembolsada.
 *
 * La capa de pagos no sabe nada de citas, pedidos ni facturas: cada módulo
 * registra aquí qué significa "esto ya está pagado" para él. Así el webhook de
 * Stripe es genérico y no acumula `if (entityType === ...)` por todo el fichero.
 *
 * ── SOBRE LA TRANSACCIÓN Y LOS EFECTOS EXTERNOS ────────────────────────────
 * Estas funciones se ejecutan DENTRO de la transacción del webhook, así que toda
 * escritura debe llevar `{ transaction: t }`. Lo que NO puede ir aquí es nada
 * irreversible hacia fuera (correos, avisos): si la transacción se deshace, el
 * correo ya se habría enviado y estaríamos diciéndole a alguien que su cita está
 * confirmada cuando en la base de datos no lo está.
 *
 * Por eso devuelven `{ outcome, postCommit }`: el webhook ejecuta `postCommit`
 * SOLO si la transacción se confirmó, y como best-effort.
 */

import { findBookingOverlap } from "../citas/booking.js";
import { getTenantResendConfig } from "../outreach/resendConfig.js";

/**
 * @param {object} ctx             tenantContext
 * @param {object} paymentSession  fila PaymentSession ya marcada como pagada
 * @param {object} [t]             transacción del webhook
 * @returns {Promise<{ outcome: string, postCommit?: () => Promise<void> }>}
 */
export async function onEntityPaid(ctx, paymentSession, t) {
  switch (paymentSession.entityType) {
    case "booking":
      return await citaPagada(ctx, paymentSession, t);
    default:
      return { outcome: `sin acción para entityType=${paymentSession.entityType}` };
  }
}

/**
 * Ventana que se concede a un cobro de LIQUIDACIÓN DIFERIDA (SEPA, Multibanco,
 * Boleto…). Stripe da por terminado el checkout en cuanto el cliente acepta,
 * pero el dinero tarda días — o no llega nunca.
 *
 * Ojo: estos métodos encajan MAL con reservar citas, porque el dinero puede
 * confirmarse después de la propia cita. Ninguno viene activado por defecto;
 * activarlos es una decisión del profesional en su panel de Stripe.
 */
export const ASYNC_SETTLEMENT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * El cliente terminó el checkout pero AÚN NO HAY DINERO (liquidación diferida).
 * No se confirma nada; solo se mantiene el hueco reservado mientras se resuelve.
 */
export async function onEntityPaymentPending(ctx, paymentSession, t) {
  switch (paymentSession.entityType) {
    case "booking": {
      const { Booking } = ctx.tenantModels;
      const cita = await Booking.findByPk(paymentSession.entityId, { transaction: t });
      if (!cita) return { outcome: "cita no encontrada" };
      if (cita.paymentStatus !== "pending") return { outcome: "la cita ya no espera pago" };

      // Se retiene el hueco mientras el dinero viaja, pero NUNCA más allá de la
      // hora de la propia cita: guardar un hueco ya pasado no sirve de nada y
      // dejaría la agenda bloqueada sin motivo.
      const tope = new Date(cita.scheduledAt);
      const propuesto = new Date(Date.now() + ASYNC_SETTLEMENT_WINDOW_MS);
      const nuevo = propuesto < tope ? propuesto : tope;

      if (cita.holdExpiresAt && new Date(cita.holdExpiresAt) >= nuevo) {
        return { outcome: "cobro diferido: el hueco ya estaba retenido lo suficiente" };
      }
      await cita.update({ holdExpiresAt: nuevo }, { transaction: t });
      return {
        outcome: `cita ${cita.id}: cobro diferido, hueco retenido hasta ${nuevo.toISOString()}`,
      };
    }
    default:
      return { outcome: `sin acción para entityType=${paymentSession.entityType}` };
  }
}

/**
 * El cobro diferido acabó FALLANDO. Se libera el hueco: nadie pagó.
 */
export async function onEntityPaymentFailed(ctx, paymentSession, t) {
  switch (paymentSession.entityType) {
    case "booking": {
      const { Booking } = ctx.tenantModels;
      const cita = await Booking.findByPk(paymentSession.entityId, { transaction: t });
      if (!cita) return { outcome: "cita no encontrada" };
      if (cita.status === "cancelled") return { outcome: "la cita ya estaba cancelada" };
      // Salvaguarda: si por lo que sea consta pagada, no se cancela por un
      // evento de fallo. Antes se mira a mano que no haya dinero de por medio.
      if (cita.paymentStatus === "paid") {
        return { outcome: `cita ${cita.id} consta PAGADA pese al fallo — revisar a mano` };
      }
      await cita.update(
        {
          status: "cancelled",
          paymentStatus: "failed",
          holdExpiresAt: null,
          cancelledAt: new Date(),
          cancellationReason: "El pago no se completó",
        },
        { transaction: t }
      );
      return { outcome: `cita ${cita.id} cancelada: el pago falló` };
    }
    default:
      return { outcome: `sin acción para entityType=${paymentSession.entityType}` };
  }
}

/**
 * Reembolso originado FUERA del CRM (p. ej. la profesional devuelve desde el
 * panel de Stripe). El CRM debe enterarse para no dejar la cita como pagada.
 */
export async function onEntityRefunded(ctx, paymentSession, t) {
  switch (paymentSession.entityType) {
    case "booking": {
      const { Booking } = ctx.tenantModels;
      const cita = await Booking.findByPk(paymentSession.entityId, { transaction: t });
      if (!cita) return { outcome: "cita no encontrada" };
      if (cita.paymentStatus === "refunded") return { outcome: "ya estaba reembolsada" };
      // Solo se toca el dinero. Que la cita siga en pie o no es decisión de quien
      // la cancele: un reembolso desde Stripe no debería borrar la cita de la
      // agenda sin que nadie se entere.
      await cita.update({ paymentStatus: "refunded" }, { transaction: t });
      return { outcome: `cita ${cita.id} marcada como reembolsada` };
    }
    default:
      return { outcome: `sin acción para entityType=${paymentSession.entityType}` };
  }
}

/**
 * Cobro recibido de una cita: se confirma y se libera la reserva provisional.
 */
async function citaPagada(ctx, paymentSession, t) {
  const { Booking, EventType } = ctx.tenantModels;

  const cita = await Booking.findByPk(paymentSession.entityId, { transaction: t });
  if (!cita) return { outcome: "cita no encontrada" };
  if (cita.paymentStatus === "paid") return { outcome: "la cita ya estaba pagada" };

  // Si la cita se canceló mientras el cliente pagaba (p. ej. la profesional la
  // rechazó), NO se confirma: se deja constancia del cobro para que el reembolso
  // sea posible, pero la agenda manda.
  const cancelada = cita.status === "cancelled";

  // ── ¿El hueco sigue siendo suyo? ─────────────────────────────────────────
  // Entre reservar y cobrar puede pasar de todo: que el hold caducara y otra
  // persona reservara y pagara esa misma hora, o que este webhook llegue con
  // horas de retraso tras los reintentos de Stripe. Confirmar sin mirar es
  // exactamente el caso de "dos pacientes cobrados por la misma hora".
  //
  // Se comprueba DENTRO de la transacción del webhook: fuera de ella la lectura
  // no vería lo que la propia transacción está escribiendo.
  if (!cancelada) {
    const choque = await findBookingOverlap(Booking, {
      scheduledAt: cita.scheduledAt,
      duration: cita.duration,
      excludeId: cita.id,
      teamMemberId: cita.teamMemberId,
      transaction: t,
    });
    if (choque) {
      // El dinero es real, así que `paid` es la verdad; lo que no hay es cita.
      // Se deja SIN confirmar y bien señalado, para devolverlo.
      await cita.update({ paymentStatus: "paid", holdExpiresAt: null }, { transaction: t });
      process.stderr.write(
        `[pagos] COBRO SIN HUECO — tenant ${ctx.slug}, cita ${cita.id}: pagada, pero la hora ya la ocupa la cita ${choque.id}. Hay que reembolsar.\n`
      );
      return {
        outcome: `cita ${cita.id} pagada pero el hueco ya estaba ocupado por ${choque.id} — REEMBOLSAR`,
      };
    }
  }

  await cita.update(
    {
      paymentStatus: "paid",
      // Pagar CONFIRMA la cita: es la decisión de negocio de este sprint.
      status: cancelada ? cita.status : "confirmed",
      // Deja de ser provisional: ya no depende de una caducidad.
      holdExpiresAt: null,
    },
    { transaction: t }
  );

  if (cancelada) {
    return { outcome: `cita ${cita.id} pagada pero estaba CANCELADA — revisar y reembolsar` };
  }

  // El correo va fuera de la transacción (ver cabecera).
  const postCommit = async () => {
    const eventType = await EventType.findByPk(cita.eventTypeId);
    const { sendEmail } = await import("../email/resendClient.js");
    const { bookingConfirmedTemplate } = await import("../email/templates/citas/bookingConfirmed.js");
    const tpl = bookingConfirmedTemplate({
      tenantName: ctx.tenant.name,
      brand: ctx.tenant.settings?.brand,
      clientName: cita.clientName,
      eventTypeName: eventType?.name ?? "Cita",
      scheduledAt: cita.scheduledAt,
      duration: cita.duration,
      modality: cita.modality,
      meetUrl: cita.meetUrl,
      cancelUrl: cita.cancellationToken
        ? `/widget/c/${ctx.slug}/cancel/${cita.cancellationToken}`
        : null,
      location: eventType?.location ?? null,
    });
    // BYOK: la confirmación tras el pago sale de la cuenta del negocio.
    const cfgResend = getTenantResendConfig(ctx);
    await sendEmail({
      to: cita.clientEmail,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      from: cfgResend.fromEmail || undefined,
      replyTo: cfgResend.replyTo || undefined,
      apiKey: cfgResend.apiKey || undefined,
    });
  };

  return { outcome: `cita ${cita.id} confirmada tras el pago`, postCommit };
}
