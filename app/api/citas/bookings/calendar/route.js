import { Op } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, forbidden, error, serverError } from "../../../../../lib/utils/apiResponse.js";
import { resolveCurrentTeamMemberId } from "../../../../../lib/team/currentTeamMember.js";
import { noEsCarritoAbandonado } from "../../../../../lib/citas/booking.js";

const STATUS_COLOR_DIM = {
  cancelled: "#9ca3af",
  no_show: "#a78bfa",
  completed: "#475569",
};

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const NADIE = "00000000-0000-0000-0000-000000000000";

/**
 * GET /api/citas/bookings/calendar?start=ISO&end=ISO
 *   &eventTypeIds=csv     (opcional) filtra por tipo de cita
 *   &teamMemberIds=csv    (opcional, SOLO admin) filtra por profesional(es)
 *
 * Devuelve bookings en formato FullCalendar para el rango pedido.
 *
 * Visibilidad por rol (tenants con módulo team):
 *   · Admin/jefe: ve las citas de TODO el equipo; puede acotar con teamMemberIds.
 *   · Resto: ve SOLO sus propias citas (las de su ficha de equipo).
 *
 * Color del evento: por PERSONA (avatar_color del profesional) si la cita tiene
 * profesional asignado; si no, el color del tipo de cita. Las
 * canceladas/no_show/completadas van apagadas.
 */
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");

    const { Booking, EventType, TeamMember } = tenantModels;
    const { searchParams } = new URL(request.url);
    const start = searchParams.get("start");
    const end = searchParams.get("end");

    if (!start || !end) return error("start y end son obligatorios");
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return error("start/end inválidos");
    }

    // Sin el filtro de carritos abandonados, el calendario pintaba como cita una
    // reserva que nadie llegó a pagar y cuyo hueco ya está libre para otros.
    const where = {
      scheduledAt: { [Op.gte]: startDate, [Op.lt]: endDate },
      ...noEsCarritoAbandonado(),
    };

    const eventTypeIds = searchParams.get("eventTypeIds"); // CSV opcional
    if (eventTypeIds) {
      const ids = eventTypeIds.split(",").map((s) => s.trim()).filter(Boolean);
      if (ids.length > 0) where.eventTypeId = { [Op.in]: ids };
    }

    const teamOn = hasModule("team");
    if (teamOn) {
      const userRole = request.headers.get("x-user-role") ?? "user";
      if (ADMIN_ROLES.has(userRole)) {
        // El jefe ve a todos; puede filtrar a uno o varios profesionales. Las
        // citas SIN profesional asignado (públicas pendientes de repartir) se
        // mantienen SIEMPRE visibles aunque filtres, para no perderlas de vista.
        const tmIds = searchParams.get("teamMemberIds");
        if (tmIds) {
          const ids = tmIds.split(",").map((s) => s.trim()).filter(Boolean);
          if (ids.length > 0) {
            where.teamMemberId = { [Op.or]: [{ [Op.in]: ids }, { [Op.is]: null }] };
          }
        }
      } else {
        // Un profesional solo ve SU agenda. Si no tiene ficha de equipo, nada.
        const myId = await resolveCurrentTeamMemberId(request, tenantModels);
        where.teamMemberId = myId ?? NADIE;
      }
    }

    const include = [{ model: EventType, as: "eventType", attributes: ["id", "name", "color"] }];
    if (teamOn) {
      include.push({ model: TeamMember, as: "teamMember", attributes: ["id", "displayName", "avatarColor"] });
    }

    const rows = await Booking.findAll({
      where,
      include,
      order: [["scheduledAt", "ASC"]],
    });

    const events = rows.map((b) => {
      const startIso = new Date(b.scheduledAt);
      const endIso = new Date(startIso.getTime() + b.duration * 60 * 1000);
      const personColor = teamOn && b.teamMember?.avatarColor ? b.teamMember.avatarColor : null;
      const baseColor = personColor || b.eventType?.color || "#3F6E5B";
      const color = STATUS_COLOR_DIM[b.status] || baseColor;
      // Solo las citas ACTIVAS se pueden arrastrar para reprogramar.
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
          teamMemberId: b.teamMemberId ?? null,
          teamMemberName: teamOn ? (b.teamMember?.displayName ?? null) : null,
        },
      };
    });

    return ok(events);
  } catch (err) {
    return serverError(err);
  }
});
