import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, noContent, forbidden } from "../../../../../../lib/utils/apiResponse.js";
import { NotFoundError, ForbiddenError } from "../../../../../../lib/utils/errors.js";
import { isAdminRole, isLeadOfProject } from "../../../../../../lib/projects/projectAuth.js";

const ADMIN_DENY = "Solo administradores o el lead del proyecto pueden modificarlo";

const EDITABLE = new Set(["name", "description", "dueDate", "status", "phaseId"]);

async function requireEditor(request, projectId, tenantModels) {
  const role = request.headers.get("x-user-role");
  const userId = request.headers.get("x-user-id");
  if (isAdminRole(role)) return true;
  return isLeadOfProject({ projectId, userId, tenantModels });
}

export const PATCH = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const { tenantModels } = ctx;
  const { Milestone } = tenantModels;
  const { id, milestoneId } = await params;

  if (!(await requireEditor(request, id, tenantModels))) return forbidden(ADMIN_DENY);

  const milestone = await Milestone.findOne({ where: { id: milestoneId, projectId: id } });
  if (!milestone) throw new NotFoundError("Hito no encontrado");

  const body = await request.json();
  const updates = {};
  for (const key of Object.keys(body)) {
    if (EDITABLE.has(key)) updates[key] = body[key];
  }
  await milestone.update(updates);
  return ok(milestone);
});

export const DELETE = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const { tenantModels } = ctx;
  const { Milestone } = tenantModels;
  const { id, milestoneId } = await params;

  if (!(await requireEditor(request, id, tenantModels))) return forbidden(ADMIN_DENY);

  const milestone = await Milestone.findOne({ where: { id: milestoneId, projectId: id } });
  if (!milestone) throw new NotFoundError("Hito no encontrado");

  await milestone.destroy();
  return noContent();
});
