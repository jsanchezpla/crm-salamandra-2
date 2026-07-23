import { Op } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, forbidden, error, serverError } from "../../../../../lib/utils/apiResponse.js";

const STATUS_COLOR_DIM = {
  cancelled: "#9ca3af",
  no_show: "#a78bfa",
  completed: "#475569",
};

/**
 * GET /api/citas/bookings/calendar?start=ISO&end=ISO
 *
 * Devuelve bookings en formato FullCalendar para el rango pedido.
 * El color del evento sale del EventType.color, salvo que el booking esté
 * cancelado/no_show/completado, donde se usa un color más apagado.
 */
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");

    const { Booking, EventType } = tenantModels;
    const { searchParams } = new URL(request.url);
    const start = searchParams.get("start");
    const end = searchParams.get("end");
    const eventTypeIds = searchParams.get("eventTypeIds"); // CSV opcional

    if (!start || !end) return error("start y end son obligatorios");
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return error("start/end inválidos");
    }

    const where = {
      scheduledAt: { [Op.gte]: startDate, [Op.lt]: endDate },
    };
    if (eventTypeIds) {
      const ids = eventTypeIds.split(",").map((s) => s.trim()).filter(Boolean);
      if (ids.length > 0) where.eventTypeId = { [Op.in]: ids };
    }

    const rows = await Booking.findAll({
      where,
      include: [{ model: EventType, as: "eventType", attributes: ["id", "name", "color"] }],
      order: [["scheduledAt", "ASC"]],
    });

    const events = rows.map((b) => {
      const startIso = new Date(b.scheduledAt);
      const endIso = new Date(startIso.getTime() + b.duration * 60 * 1000);
      const baseColor = b.eventType?.color || "#3F6E5B";
      const color = STATUS_COLOR_DIM[b.status] || baseColor;
      // Solo las citas ACTIVAS se pueden arrastrar para reprogramar. Mover una
      // cancelada/no_show/completada no tiene sentido (es historial), así que
      // FullCalendar la deja fija (startEditable=false).
      const arrastrable = b.status !== "cancelled" && b.status !== "no_show" && b.status !== "completed";
      return {
        id: b.id,
        title: b.clientName,
        start: startIso.toISOString(),
        end: endIso.toISOString(),
        backgroundColor: color,
        borderColor: color,
        startEditable: arrastrable,
        extendedProps: {
          status: b.status,
          modality: b.modality,
          clientEmail: b.clientEmail,
          clientPhone: b.clientPhone,
          eventTypeId: b.eventTypeId,
          eventTypeName: b.eventType?.name ?? null,
          duration: b.duration,
        },
      };
    });

    return ok(events);
  } catch (err) {
    return serverError(err);
  }
});
