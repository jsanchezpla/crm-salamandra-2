import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { findBookingOverlap } from "../../../../../../lib/citas/booking.js";
import { resolveCurrentTeamMemberId } from "../../../../../../lib/team/currentTeamMember.js";
import { notifyAdminsNewRequest, serializeChangeRequest } from "../../../../../../lib/citas/rescheduleRequests.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

// POST /api/citas/bookings/[id]/reschedule-request
// Una terapeuta (o el admin) PROPONE mover una cita. La cita NO se cambia: se
// crea una solicitud pendiente que el centro aprueba/rechaza ("no es definitivo").
export const POST = withTenant(async (request, { params }, ctx) => {
  try {
    if (!ctx.hasModule("citas")) return forbidden("Módulo citas no activo");
    const { id } = await params;
    const { Booking, EventType, TeamMember, Patient, BookingChangeRequest } = ctx.tenantModels;
    if (!BookingChangeRequest) return error("Solicitudes de cambio no disponibles", 422);

    const booking = await Booking.findByPk(id);
    if (!booking) return notFound("Cita no encontrada");

    // Acceso: admin, o el profesional dueño de la cita (solo lo suyo).
    const role = request.headers.get("x-user-role") ?? "user";
    const userId = request.headers.get("x-user-id") || null;
    const myMemberId = await resolveCurrentTeamMemberId(request, ctx.tenantModels);
    const isAdmin = ADMIN_ROLES.has(role);
    if (!isAdmin) {
      if (!myMemberId || !booking.teamMemberId || myMemberId !== booking.teamMemberId) {
        return forbidden("Solo puedes proponer cambios en tus propias citas");
      }
    }

    let body = {};
    try { body = await request.json(); } catch { return error("Body inválido"); }
    const datetime = typeof body?.datetime === "string" ? body.datetime : null;
    const when = datetime ? new Date(datetime) : null;
    if (!when || Number.isNaN(when.getTime())) return error("datetime inválido");
    if (when.getTime() <= Date.now()) return error("El horario propuesto ya pasó");
    const reason = typeof body?.reason === "string" ? body.reason.slice(0, 400) : null;
    const proposedTeamMemberId = typeof body?.teamMemberId === "string" && body.teamMemberId ? body.teamMemberId : (booking.teamMemberId || null);

    // Re-validar que el hueco propuesto sigue libre (para ese profesional).
    const overlap = await findBookingOverlap(Booking, {
      scheduledAt: when,
      duration: booking.duration,
      excludeId: booking.id,
      teamMemberId: proposedTeamMemberId,
    });
    if (overlap) return error("Ese horario acaba de ocuparse. Pide de nuevo los horarios.", 409);

    // Snapshots para mostrar la solicitud sin depender de joins.
    let subjectName = booking.clientName || null;
    if (booking.patientId && Patient) {
      const p = await Patient.findByPk(booking.patientId, { attributes: ["firstName", "lastName"] });
      if (p) subjectName = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || subjectName;
    }
    let eventTypeName = null;
    if (booking.eventTypeId && EventType) {
      const et = await EventType.findByPk(booking.eventTypeId, { attributes: ["name"] });
      eventTypeName = et?.name || null;
    }
    let requestedByName = null;
    let proposedTeamMemberName = null;
    if (TeamMember) {
      if (myMemberId) {
        const me = await TeamMember.findByPk(myMemberId, { attributes: ["displayName"] });
        requestedByName = me?.displayName || null;
      }
      if (proposedTeamMemberId) {
        const pm = await TeamMember.findByPk(proposedTeamMemberId, { attributes: ["displayName"] });
        proposedTeamMemberName = pm?.displayName || null;
      }
    }

    const reqRow = await BookingChangeRequest.create({
      bookingId: booking.id,
      proposedScheduledAt: when,
      proposedTeamMemberId,
      proposedTeamMemberName,
      reason,
      currentScheduledAt: booking.scheduledAt,
      subjectName,
      eventTypeName,
      requestedByUserId: userId,
      requestedByTeamMemberId: myMemberId,
      requestedByName,
      status: "pending",
    });

    await notifyAdminsNewRequest(ctx, reqRow);
    return created({ request: serializeChangeRequest(reqRow) });
  } catch (err) {
    return serverError(err);
  }
});
