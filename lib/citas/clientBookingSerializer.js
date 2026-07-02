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
