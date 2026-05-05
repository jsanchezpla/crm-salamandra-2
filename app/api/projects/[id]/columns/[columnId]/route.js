import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, noContent, forbidden } from "../../../../../../lib/utils/apiResponse.js";
import { NotFoundError, ForbiddenError, ValidationError } from "../../../../../../lib/utils/errors.js";
import { isAdminRole, isLeadOfProject } from "../../../../../../lib/projects/projectAuth.js";

const ADMIN_DENY = "Solo administradores o el lead del proyecto pueden modificarlo";

const EDITABLE = new Set(["name", "color", "wipLimit", "isDoneColumn"]);

async function requireEditor(request, projectId, tenantModels) {
  const role = request.headers.get("x-user-role");
  const userId = request.headers.get("x-user-id");
  if (isAdminRole(role)) return true;
  return isLeadOfProject({ projectId, userId, tenantModels });
}

export const PATCH = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const { tenantModels } = ctx;
  const { BoardColumn } = tenantModels;
  const { id, columnId } = await params;

  if (!(await requireEditor(request, id, tenantModels))) return forbidden(ADMIN_DENY);

  const column = await BoardColumn.findOne({ where: { id: columnId, projectId: id } });
  if (!column) throw new NotFoundError("Columna no encontrada");

  const body = await request.json();
  const updates = {};
  for (const key of Object.keys(body)) {
    if (EDITABLE.has(key)) updates[key] = body[key];
  }
  if (updates.name != null && !updates.name.trim()) {
    throw new ValidationError("'name' no puede estar vacío");
  }

  // Asegurar una sola isDoneColumn por proyecto
  if (updates.isDoneColumn === true) {
    await BoardColumn.update(
      { isDoneColumn: false },
      { where: { projectId: id, isDoneColumn: true } }
    );
  }

  await column.update(updates);
  return ok(column);
});

export const DELETE = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const { tenantModels } = ctx;
  const { BoardColumn, Task } = tenantModels;
  const { id, columnId } = await params;

  if (!(await requireEditor(request, id, tenantModels))) return forbidden(ADMIN_DENY);

  const column = await BoardColumn.findOne({ where: { id: columnId, projectId: id } });
  if (!column) throw new NotFoundError("Columna no encontrada");

  const totalCols = await BoardColumn.count({ where: { projectId: id } });
  if (totalCols <= 1) {
    throw new ValidationError("No se puede borrar la última columna del tablero");
  }

  const taskCount = await Task.count({ where: { boardColumnId: columnId } });
  if (taskCount > 0) {
    throw new ValidationError(`La columna tiene ${taskCount} tarea(s). Muévelas antes de borrar.`);
  }

  await column.destroy();

  // Recompactar order
  const remaining = await BoardColumn.findAll({
    where: { projectId: id },
    order: [["order", "ASC"]],
  });
  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i].order !== i) await remaining[i].update({ order: i });
  }

  return noContent();
});
