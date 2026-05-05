import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, noContent, forbidden } from "../../../../lib/utils/apiResponse.js";
import { NotFoundError, ForbiddenError, ValidationError } from "../../../../lib/utils/errors.js";
import { isAdminRole } from "../../../../lib/projects/projectAuth.js";

const ADMIN_DENY = "Solo administradores pueden gestionar plantillas de proyecto";

const EDITABLE = new Set([
  "name", "description", "phases", "boardColumns",
  "defaultMilestones", "defaultTags", "isActive",
]);

export const GET = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const { ProjectTemplate } = ctx.tenantModels;
  const { id } = await params;
  const tpl = await ProjectTemplate.findByPk(id);
  if (!tpl) throw new NotFoundError("Plantilla no encontrada");
  return ok(tpl);
});

export const PATCH = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const role = request.headers.get("x-user-role");
  if (!isAdminRole(role)) return forbidden(ADMIN_DENY);

  const { ProjectTemplate } = ctx.tenantModels;
  const { id } = await params;
  const tpl = await ProjectTemplate.findByPk(id);
  if (!tpl) throw new NotFoundError("Plantilla no encontrada");

  const body = await request.json();
  const updates = {};
  for (const key of Object.keys(body)) {
    if (EDITABLE.has(key)) updates[key] = body[key];
  }
  if (updates.name != null && !updates.name.trim()) {
    throw new ValidationError("'name' no puede estar vacío");
  }
  await tpl.update(updates);
  return ok(tpl);
});

export const DELETE = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const role = request.headers.get("x-user-role");
  if (!isAdminRole(role)) return forbidden(ADMIN_DENY);

  const { ProjectTemplate } = ctx.tenantModels;
  const { id } = await params;
  const tpl = await ProjectTemplate.findByPk(id);
  if (!tpl) throw new NotFoundError("Plantilla no encontrada");
  await tpl.destroy();
  return noContent();
});
