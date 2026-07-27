/**
 * Política de reembolso al cancelar una cita cobrada.
 *
 * Función PURA a propósito: no toca Stripe, ni la base de datos, ni el reloj del
 * sistema salvo que se le pase. Así se puede probar de forma exhaustiva —que es
 * justo lo que hay que hacer con las reglas que deciden si alguien recupera su
 * dinero— sin montar un cobro real para cada caso.
 *
 * Reglas acordadas con el negocio (nutri_laura, 2026-07-27):
 *   · Cancela el PACIENTE con 24 h o más de antelación → devolución íntegra.
 *   · Cancela el PACIENTE con menos de 24 h            → no se devuelve nada.
 *   · Cancela el PROFESIONAL, cuando sea               → devolución íntegra.
 *   · No se presenta (no_show)                          → no se devuelve nada.
 *
 * El umbral se mide contra la HORA DE LA CITA, no contra el día natural: "un día
 * antes" a las 23:00 para una cita a las 09:00 no son 24 h.
 */

/** Antelación mínima para que una cancelación del paciente devuelva el dinero. */
export const HORAS_MINIMAS_PARA_REEMBOLSO = 24;

/**
 * @param {object} args
 * @param {"cliente"|"profesional"|"no_show"} args.quienCancela
 * @param {Date|string} args.scheduledAt   cuándo era la cita
 * @param {string} args.paymentStatus      estado de cobro de la cita
 * @param {number} args.amount             céntimos cobrados
 * @param {Date}   [args.ahora]
 * @returns {{ reembolsar: boolean, importe: number, motivo: string }}
 */
export function decidirReembolso({ quienCancela, scheduledAt, paymentStatus, amount, ahora = new Date() }) {
  // Sin cobro no hay nada que devolver. Cubre las citas gratuitas ('none'), las
  // que se quedaron a medias ('pending') y las ya devueltas ('refunded').
  if (paymentStatus !== "paid") {
    return { reembolsar: false, importe: 0, motivo: "la cita no tiene un cobro que devolver" };
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    return { reembolsar: false, importe: 0, motivo: "la cita no tiene importe registrado" };
  }

  if (quienCancela === "profesional") {
    return { reembolsar: true, importe: amount, motivo: "cancelada por el profesional" };
  }

  if (quienCancela === "cliente") {
    const fecha = new Date(scheduledAt);
    if (Number.isNaN(fecha.getTime())) {
      // Sin fecha fiable no se puede aplicar la regla de las 24 h. Se devuelve:
      // ante la duda, el dinero vuelve a quien lo puso.
      return { reembolsar: true, importe: amount, motivo: "fecha de la cita no válida — se devuelve por precaución" };
    }
    const horas = (fecha.getTime() - ahora.getTime()) / 3_600_000;
    if (horas >= HORAS_MINIMAS_PARA_REEMBOLSO) {
      return {
        reembolsar: true,
        importe: amount,
        motivo: `cancelada por el paciente con ${Math.floor(horas)} h de antelación`,
      };
    }
    return {
      reembolsar: false,
      importe: 0,
      motivo: `cancelada con menos de ${HORAS_MINIMAS_PARA_REEMBOLSO} h de antelación (${Math.max(0, Math.floor(horas))} h)`,
    };
  }

  if (quienCancela === "no_show") {
    return { reembolsar: false, importe: 0, motivo: "el paciente no se presentó" };
  }

  // Origen desconocido: no se devuelve automáticamente, pero se dice por qué.
  return { reembolsar: false, importe: 0, motivo: `origen de cancelación no reconocido ("${quienCancela}")` };
}
