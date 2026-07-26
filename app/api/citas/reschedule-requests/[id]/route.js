import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { findBookingOverlap } from "../../../../../lib/citas/booking.js";
import { logCitasAudit } from "../../../../../lib/citas/audit.js";
import {
  serializeChangeRequest,
  notifyRequesterResolved,
  clearRequestNotifications,
} from "../../../../../lib/citas/rescheduleRequests.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

// PATCH /api/citas/reschedule-requests/[id] — el centro (admin) APRUEBA o RECHAZA
// una propuesta de cambio de cita. Al aprobar, mueve de verdad la cita.
export const PATCH = withTenant(async (request, { params }, ctx) => {
  try {
    if (!ctx.hasModule("citas")) return forbidden("Módulo citas no activo");
    const role = request.headers.get("x-user-role") ?? "user";
    if (!ADMIN_ROLES.has(role)) return forbidden("Solo el centro (admin) resuelve las solicitudes");

    const { id } = await params;
    const userId = request.headers.get("x-user-id") || null;
    const { Booking, BookingChangeRequest } = ctx.tenantModels;
    if (!BookingChangeRequest) return error("Solicitudes de cambio no disponibles", 422);

    const reqRow = await BookingChangeRequest.findByPk(id);
    if (!reqRow) return notFound("Solicitud no encontrada");
    if (reqRow.status !== "pending") return error("Esta solicitud ya estaba resuelta", 409);

    let body = {};
    try { body = await request.json(); } catch { return error("Body inválido"); }
    const action = body?.action;
    if (action !== "approve" && action !== "reject") return error("action debe ser 'approve' o 'reject'");

    if (action === "approve") {
      const booking = await Booking.findByPk(reqRow.bookingId);
      if (!booking) return notFound("La cita ya no existe");
      const when = new Date(reqRow.proposedScheduledAt);
      const proposedTeamMemberId = reqRow.proposedTeamMemberId || booking.teamMemberId || null;

      // Re-validar: puede haberse ocupado el hueco desde que se propuso.
      const overlap = await findBookingOverlap(Booking, {
        scheduledAt: when,
        duration: booking.duration,
        excludeId: booking.id,
        teamMemberId: proposedTeamMemberId,
      });
      if (overlap) return error("Ese horario ya está ocupado; no se puede aplicar la propuesta.", 409);

      const before = { scheduledAt: booking.scheduledAt, teamMemberId: booking.teamMemberId };
      const patch = { scheduledAt: when };
      if (reqRow.proposedTeamMemberId) patch.teamMemberId = reqRow.proposedTeamMemberId;
      await booking.update(patch);
      await reqRow.update({ status: "approved", resolvedByUserId: userId, resolvedAt: new Date() });
      await logCitasAudit({
        tenantId: ctx.tenant.id,
        userId,
        action: "booking.reschedule_approved",
        entity: "Booking",
        entityId: booking.id,
        before,
        after: patch,
      });
    } else {
      await reqRow.update({ status: "rejected", resolvedByUserId: userId, resolvedAt: new Date() });
    }

    await notifyRequesterResolved(ctx, reqRow, action === "approve");
    await clearRequestNotifications(ctx, reqRow.id);

    return ok({ request: serializeChangeRequest(reqRow) });
  } catch (err) {
    return serverError(err);
  }
});
