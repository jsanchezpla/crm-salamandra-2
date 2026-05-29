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
export async function findBookingOverlap(Booking, { scheduledAt, duration, excludeId = null }) {
  const start = new Date(scheduledAt);
  const end = new Date(start.getTime() + duration * 60 * 1000);

  const where = {
    status: { [Op.notIn]: ["cancelled", "no_show"] },
    scheduledAt: { [Op.lt]: end },
  };
  if (excludeId) where.id = { [Op.ne]: excludeId };

  const candidates = await Booking.findAll({ where });
  for (const b of candidates) {
    const bStart = new Date(b.scheduledAt);
    const bEnd = new Date(bStart.getTime() + b.duration * 60 * 1000);
    if (bStart < end && bEnd > start) return b;
  }
  return null;
}
