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
const RESCHEDULABLE_STATUS = new Set(["pending", "confirmed"]);

// PATCH /api/citas/reschedule-requests/[id] — el centro (admin) APRUEBA o RECHAZA
// una propuesta de cambio de cita. Al aprobar, mueve de verdad la cita.
//
// Robustez (bug 2026-07-27): todo va en UNA transacción con lock de fila sobre
// la solicitud (nadie la resuelve dos veces) y un advisory lock por profesional
// (dos aprobaciones para el mismo profesional se serializan → la re-validación
// de solape es fiable y no se cuela una doble reserva). Además se comprueba que
// la cita sigue vigente y que el horario propuesto no ha quedado en el pasado.
export const PATCH = withTenant(async (request, { params }, ctx) => {
  try {
    if (!ctx.hasModule("citas")) return forbidden("Módulo citas no activo");
    const role = request.headers.get("x-user-role") ?? "user";
    if (!ADMIN_ROLES.has(role)) return forbidden("Solo el centro (admin) resuelve las solicitudes");

    const { id } = await params;
    const userId = request.headers.get("x-user-id") || null;
    const { Booking, BookingChangeRequest } = ctx.tenantModels;
    if (!BookingChangeRequest) return error("Solicitudes de cambio no disponibles", 422);

    let body = {};
    try { body = await request.json(); } catch { return error("Body inválido"); }
    const action = body?.action;
    if (action !== "approve" && action !== "reject") return error("action debe ser 'approve' o 'reject'");

    const sequelize = ctx.tenantSequelize || BookingChangeRequest.sequelize;

    // Devuelve { fail:{code,msg} } o { reqRow, audit? } — los efectos (auditoría,
    // notificaciones) se hacen FUERA de la transacción, ya con el commit hecho.
    const result = await sequelize.transaction(async (t) => {
      const reqRow = await BookingChangeRequest.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!reqRow) return { fail: { code: 404, msg: "Solicitud no encontrada" } };
      if (reqRow.status !== "pending") return { fail: { code: 409, msg: "Esta solicitud ya estaba resuelta" } };

      if (action === "reject") {
        await reqRow.update({ status: "rejected", resolvedByUserId: userId, resolvedAt: new Date() }, { transaction: t });
        return { reqRow };
      }

      // APROBAR: mover la cita de verdad.
      const booking = await Booking.findByPk(reqRow.bookingId, { transaction: t, lock: t.LOCK.UPDATE });
      if (!booking) return { fail: { code: 404, msg: "La cita ya no existe" } };
      if (!RESCHEDULABLE_STATUS.has(booking.status)) {
        return { fail: { code: 409, msg: "La cita ya no admite reprogramación (está cancelada, completada o marcada como no asistida)." } };
      }
      const when = new Date(reqRow.proposedScheduledAt);
      if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
        return { fail: { code: 409, msg: "El horario propuesto ya ha pasado; propón uno nuevo." } };
      }
      const proposedTeamMemberId = reqRow.proposedTeamMemberId || booking.teamMemberId || null;

      // Serializa las aprobaciones para el mismo profesional: la re-validación de
      // solape que sigue es autoritativa (evita dos citas a la misma hora).
      await sequelize.query("SELECT pg_advisory_xact_lock(hashtext(:k))", {
        replacements: { k: `booking-slot:${proposedTeamMemberId ?? "none"}` },
        transaction: t,
      });

      const overlap = await findBookingOverlap(Booking, {
        scheduledAt: when,
        duration: booking.duration,
        excludeId: booking.id,
        teamMemberId: proposedTeamMemberId,
      });
      if (overlap) return { fail: { code: 409, msg: "Ese horario ya está ocupado; no se puede aplicar la propuesta." } };

      const before = { scheduledAt: booking.scheduledAt, teamMemberId: booking.teamMemberId };
      const patch = { scheduledAt: when };
      if (reqRow.proposedTeamMemberId) patch.teamMemberId = reqRow.proposedTeamMemberId;
      await booking.update(patch, { transaction: t });
      await reqRow.update({ status: "approved", resolvedByUserId: userId, resolvedAt: new Date() }, { transaction: t });
      return { reqRow, audit: { before, patch, bookingId: booking.id } };
    });

    if (result.fail) return error(result.fail.msg, result.fail.code);

    // Efectos secundarios (best-effort, ya fuera de la transacción).
    if (result.audit) {
      await logCitasAudit({
        tenantId: ctx.tenant.id,
        userId,
        action: "booking.reschedule_approved",
        entity: "Booking",
        entityId: result.audit.bookingId,
        before: result.audit.before,
        after: result.audit.patch,
      });
    }
    await notifyRequesterResolved(ctx, result.reqRow, action === "approve");
    await clearRequestNotifications(ctx, result.reqRow.id);

    return ok({ request: serializeChangeRequest(result.reqRow) });
  } catch (err) {
    return serverError(err);
  }
});
