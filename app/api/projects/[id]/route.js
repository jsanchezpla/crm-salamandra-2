import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, noContent, forbidden } from "../../../../lib/utils/apiResponse.js";
import { NotFoundError, ForbiddenError, ValidationError } from "../../../../lib/utils/errors.js";
import { serializeProject } from "../../../../lib/projects/serializeProject.js";
import { isAdminRole, isLeadOfProject } from "../../../../lib/projects/projectAuth.js";
import { getMasterModels } from "../../../../lib/db/masterDb.js";

const ADMIN_DENY = "Solo administradores o el lead del proyecto pueden modificarlo";

const EDITABLE_FIELDS = new Set([
  "name",
  "code",
  "description",
  "clientId",
  "status",
  "priority",
  "startDate",
  "dueDate",
  "budgetAmount",
  "budgetCurrency",
  "estimatedHours",
  "tags",
  "customFields",
]);

async function auditLog(data) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create(data);
  } catch {}
}

export const GET = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const { tenantModels } = ctx;
  const { Project, Client, ProjectMember, TeamMember, Phase, Milestone, BoardColumn, Task } = tenantModels;
  const { id } = await params;

  const role = request.headers.get("x-user-role");
  const userId = request.headers.get("x-user-id");
  const isAdmin = isAdminRole(role);

  const project = await Project.findByPk(id, {
    include: [
      { model: Client, as: "client", attributes: ["id", "name"] },
      {
        model: ProjectMember,
        as: "members",
        include: [{ model: TeamMember, as: "teamMember", attributes: ["id", "displayName", "email", "avatarUrl", "position"] }],
      },
      { model: Phase, as: "phases", separate: true, order: [["order", "ASC"]] },
      { model: Milestone, as: "milestones", separate: true, order: [["dueDate", "ASC"]] },
      { model: BoardColumn, as: "boardColumns", separate: true, order: [["order", "ASC"]] },
    ],
  });
  if (!project) throw new NotFoundError("Proyecto no encontrado");

  const isLead = isAdmin ? false : await isLeadOfProject({ projectId: id, userId, tenantModels });
  const taskCount = await Task.count({ where: { projectId: id } });

  const data = serializeProject(project, { isAdmin, isLead });
  data.taskCount = taskCount;
  return ok(data);
});

export const PATCH = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const { tenantModels, tenant } = ctx;
  const { Project } = tenantModels;
  const { id } = await params;

  const role = request.headers.get("x-user-role");
  const userId = request.headers.get("x-user-id");
  const isAdmin = isAdminRole(role);
  const isLead = isAdmin ? true : await isLeadOfProject({ projectId: id, userId, tenantModels });
  if (!isAdmin && !isLead) return forbidden(ADMIN_DENY);

  const project = await Project.findByPk(id);
  if (!project) throw new NotFoundError("Proyecto no encontrado");

  const body = await request.json();
  const updates = {};
  for (const key of Object.keys(body)) {
    if (EDITABLE_FIELDS.has(key)) updates[key] = body[key];
  }

  if (updates.name != null && updates.name.trim().length === 0) {
    throw new ValidationError("'name' no puede estar vacío");
  }
  if (updates.startDate || updates.dueDate) {
    const start = updates.startDate ?? project.startDate;
    const due = updates.dueDate ?? project.dueDate;
    if (start && due && new Date(due) < new Date(start)) {
      throw new ValidationError("dueDate debe ser >= startDate");
    }
  }
  if (updates.customFields) {
    updates.customFields = { ...(project.customFields ?? {}), ...updates.customFields };
  }

  const before = {
    status: project.status,
    dueDate: project.dueDate,
    budgetAmount: project.budgetAmount,
    priority: project.priority,
  };

  await project.update(updates);

  await auditLog({
    tenantId: tenant.id,
    userId,
    action: "project.updated",
    entity: "Project",
    entityId: project.id,
    before,
    after: {
      status: project.status,
      dueDate: project.dueDate,
      budgetAmount: project.budgetAmount,
      priority: project.priority,
    },
    ip: request.headers.get("x-forwarded-for"),
  });

  return ok(serializeProject(project, { isAdmin, isLead }));
});

export const DELETE = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const role = request.headers.get("x-user-role");
  if (!isAdminRole(role)) return forbidden("Solo administradores pueden archivar proyectos");

  const { tenantModels, tenant } = ctx;
  const { Project } = tenantModels;
  const { id } = await params;

  const project = await Project.findByPk(id);
  if (!project) throw new NotFoundError("Proyecto no encontrado");

  await project.update({ archivedAt: new Date() });

  await auditLog({
    tenantId: tenant.id,
    userId: request.headers.get("x-user-id"),
    action: "project.archived",
    entity: "Project",
    entityId: project.id,
    before: { archivedAt: null },
    after: { archivedAt: project.archivedAt },
    ip: request.headers.get("x-forwarded-for"),
  });

  return noContent();
});
