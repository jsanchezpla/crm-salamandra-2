import { withPublicTenant } from "../../../../../../../lib/tenant/publicTenantContext.js";
import { ok, error, notFound, serverError } from "../../../../../../../lib/utils/apiResponse.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/public/c/[tenantSlug]/booking/[token]
 *
 * Devuelve datos mínimos del booking por su cancellationToken. Usado por la
 * página de cancelación para mostrar qué se va a cancelar.
 *
 * Estados:
 *   - 200 si existe y se puede cancelar.
 *   - 410 si ya está cancelado (Gone).
 *   - 410 si scheduledAt ya pasó.
 *   - 404 si el token no existe.
 */
export const GET = withPublicTenant(async (_request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return notFound("Módulo no disponible");

    const { token } = await params;
    if (!token || !UUID_RE.test(token)) return notFound("Token no encontrado");

    const { Booking, EventType } = tenantModels;
    const row = await Booking.findOne({
      where: { cancellationToken: token },
      include: [{ model: EventType, as: "eventType", attributes: ["id", "name", "color"] }],
    });
    if (!row) return notFound("Reserva no encontrada");

    if (row.status === "cancelled") {
      return error("Esta cita ya fue cancelada", 410);
    }
    if (new Date(row.scheduledAt) <= new Date()) {
      return error("Esta cita ya ha pasado y no se puede cancelar", 410);
    }

    return ok({
      id: row.id,
      eventTypeName: row.eventType?.name ?? null,
      eventTypeColor: row.eventType?.color ?? null,
      scheduledAt: row.scheduledAt.toISOString(),
      duration: row.duration,
      clientName: row.clientName,
      cancellable: true,
    });
  } catch (err) {
    return serverError(err);
  }
});
