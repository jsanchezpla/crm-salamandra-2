import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, created, forbidden } from "../../../../../lib/utils/apiResponse.js";
import { NotFoundError, ForbiddenError, ValidationError } from "../../../../../lib/utils/errors.js";
import { isAdminRole, isLeadOfProject } from "../../../../../lib/projects/projectAuth.js";

const ADMIN_DENY = "Solo administradores o el lead del proyecto pueden modificarlo";

export const GET = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const { tenantModels } = ctx;
  const { Phase, Project } = tenantModels;
  const { id } = await params;

  const project = await Project.findByPk(id, { attributes: ["id"] });
  if (!project) throw new NotFoundError("Proyecto no encontrado");

  const phases = await Phase.findAll({
    where: { projectId: id },
    order: [["order", "ASC"]],
  });
  return ok(phases);
});

export const POST = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const { tenantModels } = ctx;
  const { Phase, Project } = tenantModels;
  const { id } = await params;

  const role = request.headers.get("x-user-role");
  const userId = request.headers.get("x-user-id");
  if (!isAdminRole(role) && !(await isLeadOfProject({ projectId: id, userId, tenantModels }))) {
    return forbidden(ADMIN_DENY);
  }

  const project = await Project.findByPk(id);
  if (!project) throw new NotFoundError("Proyecto no encontrado");

  const body = await request.json();
  const { name, description, startDate, endDate, color } = body;
  if (!name?.trim()) throw new ValidationError("'name' es obligatorio");

  const last = await Phase.findOne({
    where: { projectId: id },
    order: [["order", "DESC"]],
    attributes: ["order"],
  });
  const order = last ? last.order + 1 : 0;

  const phase = await Phase.create({
    projectId: id,
    name: name.trim(),
    description: description ?? null,
    startDate: startDate ?? null,
    endDate: endDate ?? null,
    color: color ?? null,
    order,
  });
  return created(phase);
});
