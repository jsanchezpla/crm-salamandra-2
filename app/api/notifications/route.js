import { withTenant } from "../../../lib/tenant/withTenant.js";
import { ok } from "../../../lib/utils/apiResponse.js";
import { resolveCurrentTeamMemberId } from "../../../lib/team/currentTeamMember.js";
import { syncClinicaAlerts, syncSupportAlerts, serializeNotification } from "../../../lib/notifications/alerts.js";

/**
 * GET /api/notifications — campanita del usuario logueado.
 * Sincroniza las alertas de Clínica (si el tenant lo tiene y el usuario es
 * miembro del equipo) y devuelve las últimas 50 + el nº de no leídas.
 * Tolerante a fallos: si algo peta (p. ej. falta la tabla), devuelve vacío.
 */
export const GET = withTenant(async (request, _rc, ctx) => {
  const userId = request.headers.get("x-user-id");
  if (!userId) return ok({ notifications: [], unread: 0 });
  const { Notification } = ctx.tenantModels;
  if (!Notification) return ok({ notifications: [], unread: 0 });

  try {
    if (ctx.tenantHasModule("clinica") || ctx.tenantHasModule("pacientes")) {
      const teamMemberId = await resolveCurrentTeamMemberId(request, ctx.tenantModels);
      if (teamMemberId) await syncClinicaAlerts({ models: ctx.tenantModels, userId, teamMemberId });
    }
    if (ctx.tenantHasModule("support")) {
      const teamMemberId = await resolveCurrentTeamMemberId(request, ctx.tenantModels).catch(() => null);
      const role = request.headers.get("x-user-role");
      await syncSupportAlerts({
        models: ctx.tenantModels,
        userId,
        teamMemberId,
        isAdmin: role === "admin" || role === "superadmin",
      });
    }
    const rows = await Notification.findAll({
      where: { userId, channel: "app" },
      order: [["createdAt", "DESC"]],
      limit: 50,
    });
    const unread = await Notification.count({ where: { userId, channel: "app", read: false } });
    return ok({ notifications: rows.map(serializeNotification), unread });
  } catch {
    return ok({ notifications: [], unread: 0 });
  }
});
