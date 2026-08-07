/**
 * Política de reembolso al cancelar una cita cobrada.
 *
 * Función PURA a propósito: no toca Stripe, ni la base de datos, ni el reloj del
 * sistema salvo que se le pase. Así se puede probar de forma exhaustiva —que es
 * justo lo que hay que hacer con las reglas que deciden si alguien recupera su
 * dinero— sin montar un cobro real para cada caso.
 *
 * ⚠️ REGLA ÚNICA DESDE EL 07/08/2026 (Rodrigo): EL CRM NO DEVUELVE DINERO NUNCA.
 *
 * «No se devuelve el dinero nunca. Ya lo harán ellos manualmente si tal. Si se
 * cancela algo, se mantiene la cita: la cita no se puede cancelar una vez
 * pagada, se puede cancelar una sesión concreta.»
 *
 * Lo que se cancela es UNA SESIÓN, no la compra. Lo pagado sigue pagado y se le
 * da otra fecha; si en algún caso hay que devolver algo, lo decide la consulta y
 * lo hace a mano desde Stripe, que es donde se ve el cobro entero y quien lo
 * hace responde por él. Una devolución automática es dinero saliendo de la
 * cuenta de un cliente sin que nadie lo haya mirado.
 *
 * ── LO QUE ESTO NO ES ───────────────────────────────────────────────────────
 * NO afecta a soltar una RETENCIÓN. Retener no es cobrar: si la tarjeta solo
 * tenía el dinero reservado y la cita no sale adelante, la reserva se suelta
 * —eso lo sigue haciendo `reembolsoCita.js`—. Dejarle a alguien el dinero
 * congelado por una cita que no va a existir no es «no devolver», es retenerlo
 * sin motivo.
 *
 * ── ANTES (2026-07-27 a 2026-08-07) ─────────────────────────────────────────
 * Se devolvía íntegro si cancelaba la profesional, o el paciente con 24 h o más.
 * Se retira entero, no se «apaga con un flag»: media política es la que acaba
 * devolviendo dinero el día que alguien toca el interruptor sin querer.
 */

/**
 * Antelación por debajo de la cual una cancelación se considera TARDÍA.
 *
 * ⚠️ Ya NO decide devoluciones —no hay—: hoy solo la usa `packs.js` para saber
 * si una sesión de bono cancelada a última hora se da por gastada. Se conserva
 * el nombre viejo como alias para no romper nada que lo importe.
 */
export const HORAS_PARA_CANCELACION_TARDIA = 24;
export const HORAS_MINIMAS_PARA_REEMBOLSO = HORAS_PARA_CANCELACION_TARDIA;

/**
 * @param {object} args
 * @param {"cliente"|"profesional"|"no_show"} args.quienCancela
 * @param {Date|string} args.scheduledAt   cuándo era la cita
 * @param {string} args.paymentStatus      estado de cobro de la cita
 * @param {number} args.amount             céntimos cobrados
 * @param {Date}   [args.ahora]
 * @returns {{ reembolsar: boolean, importe: number, motivo: string }}
 */
export function decidirReembolso({ paymentStatus } = {}) {
  // Siempre false: ver la cabecera. Se conservan la función y su forma de
  // respuesta porque las usan `reembolsoCita.js` y los mensajes del portal, y
  // porque el día que el negocio cambie de idea el cambio vuelve a ser AQUÍ y
  // en un solo sitio.
  if (paymentStatus !== "paid") {
    return { reembolsar: false, importe: 0, motivo: "la cita no tiene un cobro que devolver" };
  }
  return {
    reembolsar: false,
    importe: 0,
    motivo: "el dinero no se devuelve automáticamente: la sesión se cancela y el centro decide qué hacer con el importe",
  };
}

