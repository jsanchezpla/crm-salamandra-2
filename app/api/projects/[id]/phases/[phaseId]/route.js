import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, noContent, forbidden } from "../../../../../../lib/utils/apiResponse.js";
import { NotFoundError, ForbiddenError, ValidationError } from "../../../../../../lib/utils/errors.js";
import { isAdminRole, isLeadOfProject } from "../../../../../../lib/projects/projectAuth.js";

const ADMIN_DENY = "Solo administradores o el lead del proyecto pueden modificarlo";

const EDITABLE = new Set(["name", "description", "startDate", "endDate", "color", "completedAt"]);

async function requireEditor(request, projectId, tenantModels) {
  const role = request.headers.get("x-user-role");
  const userId = request.headers.get("x-user-id");
  if (isAdminRole(role)) return true;
  return isLeadOfProject({ projectId, userId, tenantModels });
}

export const PATCH = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const { tenantModels } = ctx;
  const { Phase } = tenantModels;
  const { id, phaseId } = await params;

  if (!(await requireEditor(request, id, tenantModels))) return forbidden(ADMIN_DENY);

  const phase = await Phase.findOne({ where: { id: phaseId, projectId: id } });
  if (!phase) throw new NotFoundError("Fase no encontrada");

  const body = await request.json();
  const updates = {};
  for (const key of Object.keys(body)) {
    if (EDITABLE.has(key)) updates[key] = body[key];
  }
  if (updates.name != null && !updates.name.trim()) {
    throw new ValidationError("'name' no puede estar vacío");
  }
  await phase.update(updates);
  return ok(phase);
});

export const DELETE = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const { tenantModels } = ctx;
  const { Phase, Task } = tenantModels;
  const { id, phaseId } = await params;

  if (!(await requireEditor(request, id, tenantModels))) return forbidden(ADMIN_DENY);

  const phase = await Phase.findOne({ where: { id: phaseId, projectId: id } });
  if (!phase) throw new NotFoundError("Fase no encontrada");

  const taskCount = await Task.count({ where: { phaseId } });
  if (taskCount > 0) {
    // Soft option: desvincular tasks (phaseId → null) y borrar la fase.
    await Task.update({ phaseId: null }, { where: { phaseId } });
  }

  await phase.destroy();

  // Recompactar `order` de las fases restantes
  const remaining = await Phase.findAll({
    where: { projectId: id },
    order: [["order", "ASC"]],
  });
  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i].order !== i) await remaining[i].update({ order: i });
  }

  return noContent();
});
