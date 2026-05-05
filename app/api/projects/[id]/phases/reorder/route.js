import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, forbidden } from "../../../../../../lib/utils/apiResponse.js";
import { NotFoundError, ForbiddenError, ValidationError } from "../../../../../../lib/utils/errors.js";
import { isAdminRole, isLeadOfProject } from "../../../../../../lib/projects/projectAuth.js";

const ADMIN_DENY = "Solo administradores o el lead del proyecto pueden modificarlo";

/**
 * PATCH /api/projects/[id]/phases/reorder
 * Body: { phaseIds: [uuid, uuid, ...] } en el orden deseado.
 *
 * Re-asigna `order` a las fases del proyecto según el array recibido.
 * Para evitar conflictos con el UNIQUE (projectId, order), primero se
 * desplazan los valores actuales a un rango "alto" temporal y después se
 * fijan los definitivos.
 */
export const PATCH = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const { tenantModels } = ctx;
  const { Phase, sequelize } = { ...tenantModels, sequelize: tenantModels.Phase.sequelize };
  const { id } = await params;

  const role = request.headers.get("x-user-role");
  const userId = request.headers.get("x-user-id");
  if (!isAdminRole(role) && !(await isLeadOfProject({ projectId: id, userId, tenantModels }))) {
    return forbidden(ADMIN_DENY);
  }

  const { phaseIds } = await request.json();
  if (!Array.isArray(phaseIds) || phaseIds.length === 0) {
    throw new ValidationError("phaseIds debe ser un array no vacío");
  }

  const phases = await Phase.findAll({ where: { projectId: id }, attributes: ["id"], raw: true });
  const existing = new Set(phases.map((p) => p.id));
  if (phaseIds.length !== phases.length || !phaseIds.every((pid) => existing.has(pid))) {
    throw new ValidationError("phaseIds debe contener exactamente todas las fases del proyecto");
  }

  await sequelize.transaction(async (t) => {
    // Paso 1: shift a rango temporal alto
    for (let i = 0; i < phaseIds.length; i++) {
      await Phase.update({ order: 1000 + i }, { where: { id: phaseIds[i] }, transaction: t });
    }
    // Paso 2: orden definitivo
    for (let i = 0; i < phaseIds.length; i++) {
      await Phase.update({ order: i }, { where: { id: phaseIds[i] }, transaction: t });
    }
  });

  const updated = await Phase.findAll({ where: { projectId: id }, order: [["order", "ASC"]] });
  return ok(updated);
});
