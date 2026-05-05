import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, created, forbidden } from "../../../../../lib/utils/apiResponse.js";
import { NotFoundError, ForbiddenError, ValidationError } from "../../../../../lib/utils/errors.js";
import { isAdminRole, isLeadOfProject } from "../../../../../lib/projects/projectAuth.js";

const ADMIN_DENY = "Solo administradores o el lead del proyecto pueden modificarlo";

export const GET = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const { Milestone, Project } = ctx.tenantModels;
  const { id } = await params;
  const project = await Project.findByPk(id, { attributes: ["id"] });
  if (!project) throw new NotFoundError("Proyecto no encontrado");

  const milestones = await Milestone.findAll({
    where: { projectId: id },
    order: [["dueDate", "ASC"]],
  });
  return ok(milestones);
});

export const POST = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const { tenantModels } = ctx;
  const { Milestone, Project } = tenantModels;
  const { id } = await params;

  const role = request.headers.get("x-user-role");
  const userId = request.headers.get("x-user-id");
  if (!isAdminRole(role) && !(await isLeadOfProject({ projectId: id, userId, tenantModels }))) {
    return forbidden(ADMIN_DENY);
  }

  const project = await Project.findByPk(id);
  if (!project) throw new NotFoundError("Proyecto no encontrado");

  const body = await request.json();
  const { name, description, dueDate, phaseId, status } = body;
  if (!name?.trim()) throw new ValidationError("'name' es obligatorio");
  if (!dueDate) throw new ValidationError("'dueDate' es obligatorio");

  const milestone = await Milestone.create({
    projectId: id,
    phaseId: phaseId ?? null,
    name: name.trim(),
    description: description ?? null,
    dueDate,
    status: status ?? "pending",
  });
  return created(milestone);
});
