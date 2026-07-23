import { Op } from "sequelize";

/**
 * Comprueba si una franja [start, end) solapa con bookings activos del tenant
 * (status NO IN ['cancelled', 'no_show']). Excluye opcionalmente un id.
 *
 * Usado por:
 *   - app/api/citas/bookings/route.js          (creación manual admin)
 *   - app/api/citas/bookings/[id]/route.js     (PATCH con cambio de hora)
 *   - app/api/public/c/[tenantSlug]/book/...   (creación desde landing)
 *
 * Recibe el modelo `Booking` (no la instancia tenant) para mantener el helper
 * agnóstico al pool de conexiones.
 */
export async function findBookingOverlap(Booking, { scheduledAt, duration, excludeId = null, teamMemberId = null }) {
  const start = new Date(scheduledAt);
  const end = new Date(start.getTime() + duration * 60 * 1000);

  const where = {
    status: { [Op.notIn]: ["cancelled", "no_show"] },
    scheduledAt: { [Op.lt]: end },
  };
  if (excludeId) where.id = { [Op.ne]: excludeId };

  // Proyecta SOLO lo que el chequeo necesita. Así el write-path público de
  // reservas queda desacoplado de columnas FK que se añadan al modelo después:
  // un `findAll` sin `attributes` haría SELECT de todas y reventaría con 42703
  // donde una migración no hubiera corrido. `team_member_id` SÍ se incluye porque
  // es CORE (migrate-calendar-citas-fks corre en todos los tenants con bookings).
  const candidates = await Booking.findAll({
    where,
    attributes: ["id", "scheduledAt", "duration", "status", "teamMemberId"],
  });
  // Solape POR PROFESIONAL: dos citas de personas distintas NO solapan (agendas
  // separadas). Una cita sin profesional asignado (null) bloquea a todos y una
  // cita nueva sin profesional choca con cualquiera — así una reserva pública
  // (siempre sin profesional) sigue respetando la ocupación general.
  const mineId = teamMemberId || null;
  for (const b of candidates) {
    const otherId = b.teamMemberId || null;
    if (mineId && otherId && mineId !== otherId) continue;
    const bStart = new Date(b.scheduledAt);
    const bEnd = new Date(bStart.getTime() + b.duration * 60 * 1000);
    if (bStart < end && bEnd > start) return b;
  }
  return null;
}
