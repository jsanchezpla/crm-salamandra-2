/**
 * lib/citas/rescheduleRequests.js — helpers de las solicitudes de cambio de cita
 * (terapeuta propone → admin aprueba/rechaza). Aísla el trabajo con la campanita
 * (notificaciones a los admins del tenant y al terapeuta) y la serialización.
 *
 * (Fichero nuevo en /lib, regla #2.)
 */
import { Op } from "sequelize";
import { getMasterModels } from "../db/masterDb.js";

const ADMIN_ROLES = ["admin", "superadmin"];

// Ids de los usuarios admin del tenant (viven en el schema master).
async function adminUserIds(ctx) {
  try {
    const { User } = getMasterModels();
    const rows = await User.findAll({
      where: { tenantId: ctx.tenant.id, role: { [Op.in]: ADMIN_ROLES } },
      attributes: ["id"],
    });
    return rows.map((r) => r.id);
  } catch {
    return [];
  }
}

// Una notificación de campanita por cada admin. La campanita es un añadido: si
// algo falla, no rompe la creación de la solicitud.
export async function notifyAdminsNewRequest(ctx, req) {
  try {
    const { Notification } = ctx.tenantModels;
    if (!Notification) return;
    const ids = await adminUserIds(ctx);
    for (const uid of ids) {
      await Notification.findOrCreate({
        where: { userId: uid, type: "reschedule_request", entityId: req.id },
        defaults: {
          userId: uid,
          channel: "app",
          type: "reschedule_request",
          entityType: "BookingChangeRequest",
          entityId: req.id,
          title: "Propuesta de cambio de cita",
          body: `${req.requestedByName || "Una terapeuta"} propone mover la cita de ${req.subjectName || "un paciente"}.`,
          read: false,
        },
      });
    }
  } catch {
    /* silencioso */
  }
}

// Avisa al terapeuta que propuso, cuando el centro resuelve.
export async function notifyRequesterResolved(ctx, req, approved) {
  try {
    const { Notification } = ctx.tenantModels;
    if (!Notification || !req.requestedByUserId) return;
    await Notification.create({
      userId: req.requestedByUserId,
      channel: "app",
      type: "reschedule_request_resolved",
      entityType: "BookingChangeRequest",
      entityId: req.id,
      title: approved ? "Cambio de cita aprobado" : "Cambio de cita rechazado",
      body: `Tu propuesta para ${req.subjectName || "la cita"} fue ${approved ? "aprobada" : "rechazada"} por el centro.`,
      read: false,
    });
  } catch {
    /* silencioso */
  }
}

// Al resolver una solicitud, retira las notificaciones de "pendiente" de los admins.
export async function clearRequestNotifications(ctx, requestId) {
  try {
    const { Notification } = ctx.tenantModels;
    if (!Notification) return;
    await Notification.destroy({ where: { type: "reschedule_request", entityId: requestId } });
  } catch {
    /* silencioso */
  }
}

export function serializeChangeRequest(r) {
  const j = r.toJSON ? r.toJSON() : r;
  return {
    id: j.id,
    bookingId: j.bookingId,
    proposedScheduledAt: j.proposedScheduledAt,
    proposedTeamMemberId: j.proposedTeamMemberId ?? null,
    proposedTeamMemberName: j.proposedTeamMemberName ?? null,
    reason: j.reason ?? null,
    currentScheduledAt: j.currentScheduledAt ?? null,
    subjectName: j.subjectName ?? null,
    eventTypeName: j.eventTypeName ?? null,
    requestedByName: j.requestedByName ?? null,
    status: j.status,
    createdAt: j.createdAt ?? null,
    resolvedAt: j.resolvedAt ?? null,
  };
}
