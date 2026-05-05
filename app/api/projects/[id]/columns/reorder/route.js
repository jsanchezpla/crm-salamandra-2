import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, forbidden } from "../../../../../../lib/utils/apiResponse.js";
import { ForbiddenError, ValidationError } from "../../../../../../lib/utils/errors.js";
import { isAdminRole, isLeadOfProject } from "../../../../../../lib/projects/projectAuth.js";

const ADMIN_DENY = "Solo administradores o el lead del proyecto pueden modificarlo";

export const PATCH = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const { tenantModels } = ctx;
  const { BoardColumn } = tenantModels;
  const sequelize = BoardColumn.sequelize;
  const { id } = await params;

  const role = request.headers.get("x-user-role");
  const userId = request.headers.get("x-user-id");
  if (!isAdminRole(role) && !(await isLeadOfProject({ projectId: id, userId, tenantModels }))) {
    return forbidden(ADMIN_DENY);
  }

  const { columnIds } = await request.json();
  if (!Array.isArray(columnIds) || columnIds.length === 0) {
    throw new ValidationError("columnIds debe ser un array no vacío");
  }

  const cols = await BoardColumn.findAll({ where: { projectId: id }, attributes: ["id"], raw: true });
  const existing = new Set(cols.map((c) => c.id));
  if (columnIds.length !== cols.length || !columnIds.every((cid) => existing.has(cid))) {
    throw new ValidationError("columnIds debe contener exactamente todas las columnas del proyecto");
  }

  await sequelize.transaction(async (t) => {
    for (let i = 0; i < columnIds.length; i++) {
      await BoardColumn.update({ order: 1000 + i }, { where: { id: columnIds[i] }, transaction: t });
    }
    for (let i = 0; i < columnIds.length; i++) {
      await BoardColumn.update({ order: i }, { where: { id: columnIds[i] }, transaction: t });
    }
  });

  const updated = await BoardColumn.findAll({ where: { projectId: id }, order: [["order", "ASC"]] });
  return ok(updated);
});
