import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { isDemoTenant } from "../../../../lib/demo/isDemo.js";
import { notificarSolicitante } from "../../../../lib/ai/aiAccess.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PATCH /api/ai-permisos/[id] — decidir sobre una solicitud de IA.
 *
 * Body: { decision: "conceder-general" | "conceder-una-vez" | "denegar" | "revocar" }
 *
 * Transiciones válidas:
 *   pendiente → concedido (general o una-vez) | denegado
 *   concedido → revocado
 *
 * Solo admin (rol fresco de BD). Nunca desde la demo pública. Se avisa al
 * solicitante por la campana y queda rastro en AuditLog (sin datos sensibles).
 */
export const PATCH = withTenant(async (request, { params }, ctx) => {
  try {
    if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin");
    if (isDemoTenant(ctx)) return forbidden("En la demo no se pueden gestionar permisos: es de solo lectura.");

    const { id } = await params;
    if (!UUID_RE.test(id)) return error("id inválido", 422);

    const { AiPermission } = ctx.tenantModels;
    if (!AiPermission) return notFound("Permisos de IA no disponibles en este tenant");
    const fila = await AiPermission.findByPk(id);
    if (!fila) return notFound("Solicitud no encontrada");

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }
    const decision = String(body?.decision || "");

    const adminId = ctx.user?.id || request.headers.get("x-user-id");
    const before = { status: fila.status, scope: fila.scope };
    let title;
    let bodyMsg;

    if (decision === "conceder-general" || decision === "conceder-una-vez") {
      if (fila.status !== "pendiente") return error("Esta solicitud ya está decidida", 409);
      const scope = decision === "conceder-general" ? "general" : "una-vez";
      await fila.update({ status: "concedido", scope, decidedBy: adminId, decidedAt: new Date() });
      title = "Permiso de IA concedido";
      bodyMsg = scope === "general"
        ? "Ya puedes usar la IA del CRM sin pedir permiso cada vez."
        : "Puedes usar la IA una vez. Si necesitas más usos, vuelve a intentarlo y se pedirá permiso de nuevo.";
    } else if (decision === "denegar") {
      if (fila.status !== "pendiente") return error("Esta solicitud ya está decidida", 409);
      await fila.update({ status: "denegado", decidedBy: adminId, decidedAt: new Date() });
      title = "Permiso de IA denegado";
      bodyMsg = "El administrador ha rechazado tu solicitud para usar la IA.";
    } else if (decision === "revocar") {
      if (fila.status !== "concedido") return error("Solo se puede revocar una concesión", 409);
      await fila.update({ status: "revocado", decidedBy: adminId, decidedAt: new Date() });
      title = "Permiso de IA retirado";
      bodyMsg = "El administrador ha retirado tu permiso para usar la IA. Si la necesitas, al usarla se pedirá de nuevo.";
    } else {
      return error("decision debe ser conceder-general, conceder-una-vez, denegar o revocar", 422);
    }

    await notificarSolicitante(ctx, fila.userId, title, bodyMsg);

    try {
      const { AuditLog } = getMasterModels();
      await AuditLog.create({
        tenantId: ctx.tenant.id,
        userId: adminId,
        action: `ai.permiso_${fila.status}`,
        entity: "AiPermission",
        entityId: fila.id,
        before,
        after: { status: fila.status, scope: fila.scope },
        ip: request.headers.get("x-forwarded-for") ?? null,
      });
    } catch { /* auditoría best-effort */ }

    return ok({ id: fila.id, status: fila.status, scope: fila.scope });
  } catch (err) {
    return serverError(err);
  }
});
