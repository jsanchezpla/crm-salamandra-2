/**
 * Política de reembolso al cancelar una cita cobrada.
 *
 * Función PURA a propósito: no toca Stripe, ni la base de datos, ni el reloj del
 * sistema salvo que se le pase. Así se puede probar de forma exhaustiva —que es
 * justo lo que hay que hacer con las reglas que deciden si alguien recupera su
 * dinero— sin montar un cobro real para cada caso.
 *
 * ⚠️ REGLA DESDE EL 07/08/2026 (Rodrigo): EL CRM NO DEVUELVE DINERO AL CANCELAR.
 * Tiene UNA excepción, la del 20/08/2026, y está más abajo con su nombre.
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
 * ── LA ÚNICA EXCEPCIÓN, CON NOMBRE (20/08/2026, Jorge) ──────────────────────
 * `MOTIVO_COBRO_DE_CITA_CANCELADA`: se capturó el cobro de una cita que, en esos
 * milisegundos, otra petición ya había cancelado. Ahí SÍ se devuelve, entero.
 *
 * La regla de arriba se pensó para cuando cancela la PACIENTE: hay una compra
 * viva y lo que se mueve es una sesión. Este caso no se le parece en nada. El
 * cobro es un fallo NUESTRO —una carrera de milisegundos dentro de `/confirm`—
 * y lo cobrado no compra nada, porque la cita ya no existe. Quedarse ese dinero
 * no es «que lo decida la consulta»: es cobrar por algo que no se ha dado.
 *
 * La excepción entra por su NOMBRE y por ningún otro sitio: quien no pase
 * `motivo` sigue con la regla de arriba, así que ninguna de las cinco vías de
 * cancelación devuelve nada por error.
 *
 * ── LO QUE ESTO NO ES ───────────────────────────────────────────────────────
 * NO afecta a soltar una RETENCIÓN. Retener no es cobrar: si la tarjeta solo
 * tenía el dinero reservado y la cita no sale adelante, la reserva se suelta
 * —eso lo sigue haciendo `reembolsoCita.js`, y ANTES de preguntar aquí—.
 * Dejarle a alguien el dinero congelado por una cita que no va a existir no es
 * «no devolver», es retenerlo sin motivo.
 *
 * ── ANTES (2026-07-27 a 2026-08-07) ─────────────────────────────────────────
 * Se devolvía íntegro si cancelaba la profesional, o el paciente con 24 h o más.
 * Se retira entero, no se «apaga con un flag»: media política es la que acaba
 * devolviendo dinero el día que alguien toca el interruptor sin querer.
 */

/**
 * Antelación por debajo de la cual una cancelación se considera TARDÍA.
 *
 * ⚠️ Ya NO decide devoluciones —la única que hay no mira la antelación, mira el
 * motivo—: hoy solo la usa `packs.js` para saber
 * si una sesión de bono cancelada a última hora se da por gastada. Se conserva
 * el nombre viejo como alias para no romper nada que lo importe.
 */
export const HORAS_PARA_CANCELACION_TARDIA = 24;
export const HORAS_MINIMAS_PARA_REEMBOLSO = HORAS_PARA_CANCELACION_TARDIA;

/**
 * El único motivo que devuelve dinero (ver «LA ÚNICA EXCEPCIÓN» en la cabecera).
 * Lo pasa `app/api/citas/bookings/[id]/confirm/route.js` cuando ha capturado el
 * cobro y, al volver de Stripe, la cita ya no estaba en pie.
 */
export const MOTIVO_COBRO_DE_CITA_CANCELADA = "cobro_de_cita_cancelada";

/**
 * @param {object} args
 * @param {string} args.paymentStatus   estado de cobro de la cita
 * @param {number} [args.amount]        céntimos cobrados
 * @param {string} [args.motivo]        por qué se pregunta; solo
 *   `MOTIVO_COBRO_DE_CITA_CANCELADA` abre la puerta
 * @returns {{ reembolsar: boolean, importe: number, motivo: string }}
 *   `motivo` empieza en mayúscula porque `/confirm` lo pega detrás de un punto
 *   para componer su 409; es una frase, no una coletilla.
 */
export function decidirReembolso({ paymentStatus, amount, motivo } = {}) {
  // Se conservan la función y su forma de respuesta porque las usan
  // `reembolsoCita.js` y los mensajes del portal, y porque el día que el negocio
  // cambie de idea el cambio vuelve a ser AQUÍ y en un solo sitio.
  if (paymentStatus !== "paid") {
    return { reembolsar: false, importe: 0, motivo: "La cita no tiene un cobro que devolver" };
  }

  if (motivo === MOTIVO_COBRO_DE_CITA_CANCELADA) {
    // Entero siempre: no se le ha dado nada a cambio. `importe` es informativo
    // —quien devuelve le pide a Stripe lo que QUEDE del cobro—, así que una cita
    // sin importe apuntado se devuelve igual.
    return {
      reembolsar: true,
      importe: Number.isInteger(amount) && amount > 0 ? amount : 0,
      motivo: "Se cobró una cita que ya estaba cancelada: el cobro fue un fallo del CRM y se devuelve entero",
    };
  }

  return {
    reembolsar: false,
    importe: 0,
    motivo: "El dinero no se devuelve automáticamente: la sesión se cancela y el centro decide qué hacer con el importe",
  };
}

