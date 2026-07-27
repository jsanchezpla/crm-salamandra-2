/**
 * Qué hacer cuando una entidad queda pagada o reembolsada.
 *
 * La capa de pagos no sabe nada de citas, pedidos ni facturas: cada módulo
 * registra aquí qué significa "esto ya está pagado" para él. Así el webhook de
 * Stripe es genérico y no acumula `if (entityType === ...)` por todo el fichero.
 *
 * Fase 1: solo el esqueleto. La rama "booking" la rellena la fase 3 (citas), que
 * es quien debe confirmar la reserva al cobrarse.
 */

/**
 * @param {object} ctx             tenantContext
 * @param {object} paymentSession  fila PaymentSession ya marcada como pagada
 * @param {object} [t]             transacción del webhook: TODA escritura debe ir
 *                                 dentro, o se perderá si el evento se deshace
 * @returns {Promise<string>}      descripción corta de lo hecho (para auditoría)
 */
export async function onEntityPaid(ctx, paymentSession, t) {
  switch (paymentSession.entityType) {
    // case "booking": ← fase 3 (citas): confirmar el Booking
    default:
      return `sin acción para entityType=${paymentSession.entityType}`;
  }
}

/**
 * Reembolso originado FUERA del CRM (p. ej. Laura devuelve desde el panel de
 * Stripe). El CRM debe enterarse para no dejar la cita como pagada.
 */
export async function onEntityRefunded(ctx, paymentSession, t) {
  switch (paymentSession.entityType) {
    // case "booking": ← fase 3 (citas)
    default:
      return `sin acción para entityType=${paymentSession.entityType}`;
  }
}
