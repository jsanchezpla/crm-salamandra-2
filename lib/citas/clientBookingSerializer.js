/**
 * Serialización de Booking para el cliente en el portal público "Mis citas".
 *
 * Solo expone campos seguros para el cliente dueño de la cita (identificado por
 * email). Oculta datos internos: `notes`, `clientPhone`, `additionalData`,
 * `cancellationReason`, `cancellationToken`, etc. El `meetUrl` solo se revela si
 * la cita está confirmada y es online.
 */

function isActive(status) {
  return status === "pending" || status === "confirmed";
}

/** Margen a partir del cual cancelar devuelve el importe íntegro. */
const HORAS_PARA_DEVOLUCION = 24;

/**
 * Qué pasa con su dinero SI CANCELA AHORA.
 *
 * Se calcula aquí, en el servidor, y no en la pantalla: la política de
 * devolución la aplica `lib/citas/politicaReembolso.js`, y si el widget hiciera
 * su propia cuenta acabarían diciendo cosas distintas — que es peor que no decir
 * nada, porque la pantalla prometería una devolución que luego no llega.
 *
 * Es lo que le faltaba al diálogo de cancelar: alguien con la cita pagada
 * cancelaba dieciocho horas antes, perdía el importe entero y NADIE se lo decía,
 * ni antes de pulsar ni después.
 */
function queLePasaAlDinero(row, now, bonos = null) {
  /*
   * ⚠️ SI LA CITA SALE DE UN BONO, NO SE DEVUELVE NADA. Va lo PRIMERO, antes de
   * mirar el cobro (07/08/2026, Rodrigo).
   *
   * El fallo: la cita que COMPRÓ el bono queda con su importe y en `paid`, así
   * que caía en la rama de abajo y el portal prometía «se te devolverán los
   * 1,00 € íntegros». No es verdad y `lib/citas/reembolsoCita.js` nunca lo hizo:
   * ahí un `packId` devuelve `reembolsado: false` a propósito. Lo que se
   * cancela es LA CITA, no el programa — el bono sigue comprado y la sesión
   * vuelve a estar libre para darle otra fecha.
   *
   * Prometer una devolución que no llega es peor que no decir nada: la paciente
   * cancela contando con el dinero y luego reclama.
   */
  if (row.packId) {
    return {
      tipo: "vuelve_al_bono",
      importe: null,
      // Cuántas le quedan DESPUÉS de cancelar esta: la que se cancela deja de
      // contar y vuelve al bono, así que se suma una.
      sesionesRestantes: bonos?.get?.(row.packId) != null ? bonos.get(row.packId) + 1 : null,
    };
  }

  const importe = Number.isInteger(row.amount) && row.amount > 0 ? row.amount : null;
  if (!importe) return { tipo: "nada", importe: null };

  switch (row.paymentStatus) {
    case "authorized":
    case "capturing":
      // Retenido pero no cobrado: cancelar lo suelta, pase lo que pase.
      return { tipo: "se_libera", importe };
    case "paid": {
      const horas = (new Date(row.scheduledAt).getTime() - now.getTime()) / 3_600_000;
      return horas >= HORAS_PARA_DEVOLUCION
        ? { tipo: "se_devuelve", importe }
        : { tipo: "se_pierde", importe };
    }
    case "refunded":
      return { tipo: "ya_devuelto", importe };
    default:
      return { tipo: "nada", importe: null };
  }
}

export function serializeClientBooking(row, now = new Date(), bonos = null) {
  const scheduled = new Date(row.scheduledAt);
  const isFuture = scheduled.getTime() > now.getTime();
  const isOnlineConfirmed = row.status === "confirmed" && row.modality === "online";
  return {
    id: row.id,
    eventTypeName: row.eventType?.name ?? null,
    eventTypeColor: row.eventType?.color ?? null,
    // ¿Es la primera visita? El portal lo usa para no volver a preguntar
    // «¿entras a una valoración inicial?» a quien ya la tiene cogida
    // (04/08/2026). Va aquí y no en una consulta aparte porque las citas de la
    // persona ya se están leyendo enteras para pintar el portal.
    esValoracionInicial: Boolean(row.eventType?.isInitialAssessment),
    scheduledAt: scheduled.toISOString(),
    duration: row.duration,
    modality: row.modality,
    status: row.status,
    meetUrl: isOnlineConfirmed ? row.meetUrl ?? null : null,
    cancellable: isActive(row.status) && isFuture,
    // Solo la consecuencia, nunca el estado interno del cobro: al paciente le
    // importa qué pasa con su dinero, no cómo lo llamamos por dentro.
    siCancela: queLePasaAlDinero(row, now, bonos),
  };
}

/**
 * Divide las citas de un cliente en próximas (activas y futuras) e historial.
 *   - upcoming: pending|confirmed con `scheduledAt` futuro, ASC (más próxima primero).
 *   - history:  el resto (pasadas, completed, cancelled, no_show), DESC (más reciente primero).
 */
/**
 * @param bonos Map<packId, sesionesRestantes> — opcional. Sin él, una cita de
 *              bono dice que la sesión vuelve al bono pero no cuántas quedan.
 */
export function splitBookings(rows, now = new Date(), bonos = null) {
  const upcoming = [];
  const history = [];
  for (const row of rows) {
    const scheduled = new Date(row.scheduledAt);
    const isFuture = scheduled.getTime() > now.getTime();
    const item = serializeClientBooking(row, now, bonos);
    if (isActive(row.status) && isFuture) upcoming.push(item);
    else history.push(item);
  }
  upcoming.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
  history.sort((a, b) => new Date(b.scheduledAt) - new Date(a.scheduledAt));
  return { upcoming, history };
}
