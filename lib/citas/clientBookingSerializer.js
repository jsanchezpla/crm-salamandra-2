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
function queLePasaAlDinero(row, now) {
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

export function serializeClientBooking(row, now = new Date()) {
  const scheduled = new Date(row.scheduledAt);
  const isFuture = scheduled.getTime() > now.getTime();
  const isOnlineConfirmed = row.status === "confirmed" && row.modality === "online";
  return {
    id: row.id,
    eventTypeName: row.eventType?.name ?? null,
    eventTypeColor: row.eventType?.color ?? null,
    scheduledAt: scheduled.toISOString(),
    duration: row.duration,
    modality: row.modality,
    status: row.status,
    meetUrl: isOnlineConfirmed ? row.meetUrl ?? null : null,
    cancellable: isActive(row.status) && isFuture,
    // Solo la consecuencia, nunca el estado interno del cobro: al paciente le
    // importa qué pasa con su dinero, no cómo lo llamamos por dentro.
    siCancela: queLePasaAlDinero(row, now),
  };
}

/**
 * Divide las citas de un cliente en próximas (activas y futuras) e historial.
 *   - upcoming: pending|confirmed con `scheduledAt` futuro, ASC (más próxima primero).
 *   - history:  el resto (pasadas, completed, cancelled, no_show), DESC (más reciente primero).
 */
export function splitBookings(rows, now = new Date()) {
  const upcoming = [];
  const history = [];
  for (const row of rows) {
    const scheduled = new Date(row.scheduledAt);
    const isFuture = scheduled.getTime() > now.getTime();
    const item = serializeClientBooking(row, now);
    if (isActive(row.status) && isFuture) upcoming.push(item);
    else history.push(item);
  }
  upcoming.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
  history.sort((a, b) => new Date(b.scheduledAt) - new Date(a.scheduledAt));
  return { upcoming, history };
}
