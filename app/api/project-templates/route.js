import { withTenant } from "../../../lib/tenant/withTenant.js";
import { ok, created, forbidden } from "../../../lib/utils/apiResponse.js";
import { ForbiddenError, ValidationError } from "../../../lib/utils/errors.js";
import { isAdminRole } from "../../../lib/projects/projectAuth.js";

const ADMIN_DENY = "Solo administradores pueden gestionar plantillas de proyecto";

export const GET = withTenant(async (request, _ctx, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const { ProjectTemplate } = ctx.tenantModels;
  const { searchParams } = new URL(request.url);
  const onlyActive = searchParams.get("onlyActive") === "true";

  const where = onlyActive ? { isActive: true } : {};
  const templates = await ProjectTemplate.findAll({ where, order: [["name", "ASC"]] });
  return ok(templates);
});

export const POST = withTenant(async (request, _ctx, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const role = request.headers.get("x-user-role");
  if (!isAdminRole(role)) return forbidden(ADMIN_DENY);

  const { ProjectTemplate } = ctx.tenantModels;
  const body = await request.json();
  const { name, description, phases, boardColumns, defaultMilestones, defaultTags, isActive } = body;
  if (!name?.trim()) throw new ValidationError("'name' es obligatorio");

  const tpl = await ProjectTemplate.create({
    name: name.trim(),
    description: description ?? null,
    phases: Array.isArray(phases) ? phases : [],
    boardColumns: Array.isArray(boardColumns) ? boardColumns : [],
    defaultMilestones: Array.isArray(defaultMilestones) ? defaultMilestones : [],
    defaultTags: Array.isArray(defaultTags) ? defaultTags : [],
    isActive: isActive !== false,
  });
  return created(tpl);
});
