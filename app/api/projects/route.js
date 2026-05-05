import { withTenant } from "../../../lib/tenant/withTenant.js";
import { ok, created, forbidden } from "../../../lib/utils/apiResponse.js";
import { ValidationError, ForbiddenError } from "../../../lib/utils/errors.js";
import { Op } from "sequelize";
import { serializeProject } from "../../../lib/projects/serializeProject.js";
import { generateProjectCode } from "../../../lib/projects/generateProjectCode.js";
import { createDefaultBoardColumns } from "../../../lib/projects/createDefaultBoardColumns.js";
import { isAdminRole, fetchLeadProjectIds, findOwnTeamMember } from "../../../lib/projects/projectAuth.js";
import { getMasterModels } from "../../../lib/db/masterDb.js";

async function auditLog(data) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create(data);
  } catch {}
}

export const GET = withTenant(async (request, _ctx, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const { tenantModels, tenant } = ctx;
  const { Project, Client, ProjectMember, TeamMember } = tenantModels;

  const role = request.headers.get("x-user-role");
  const userId = request.headers.get("x-user-id");
  const isAdmin = isAdminRole(role);
  const leadProjectIds = await fetchLeadProjectIds({ userId, tenantModels });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const clientId = searchParams.get("clientId");
  const leadOf = searchParams.get("leadOf");
  const search = searchParams.get("search");
  const includeArchived = searchParams.get("includeArchived") === "true";
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 200);
  const offset = parseInt(searchParams.get("offset") ?? "0");

  const where = {};
  if (!includeArchived) where.archivedAt = null;
  if (status) where.status = status;
  if (clientId) where.clientId = clientId;
  if (search) {
    where[Op.or] = [
      { name: { [Op.iLike]: `%${search}%` } },
      { code: { [Op.iLike]: `%${search}%` } },
    ];
  }

  // Filtro "soy lead" / "lead específico"
  if (leadOf) {
    const teamMemberId = leadOf;
    const memberships = await ProjectMember.findAll({
      where: { teamMemberId, role: "lead" },
      attributes: ["projectId"],
      raw: true,
    });
    where.id = memberships.map((m) => m.projectId);
    if (where.id.length === 0) return ok({ projects: [], total: 0 });
  }

  const { rows, count } = await Project.findAndCountAll({
    where,
    limit,
    offset,
    order: [["createdAt", "DESC"]],
    include: [
      { model: Client, as: "client", attributes: ["id", "name"] },
      {
        model: ProjectMember,
        as: "members",
        where: { role: "lead" },
        required: false,
        include: [{ model: TeamMember, as: "teamMember", attributes: ["id", "displayName", "avatarUrl"] }],
      },
    ],
  });

  const projects = rows.map((p) => serializeProject(p, { isAdmin, leadProjectIds }));
  return ok({ projects, total: count, tenant: tenant.slug });
});

export const POST = withTenant(async (request, _ctx, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();

  const { tenantModels, tenant } = ctx;
  const { Project } = tenantModels;
  const role = request.headers.get("x-user-role");
  const userId = request.headers.get("x-user-id");
  const isAdmin = isAdminRole(role);

  const body = await request.json();
  const {
    name,
    code,
    description,
    clientId,
    status,
    priority,
    startDate,
    dueDate,
    budgetAmount,
    budgetCurrency,
    estimatedHours,
    tags,
    customFields,
  } = body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    throw new ValidationError("El campo 'name' es obligatorio");
  }
  if (name.trim().length > 200) {
    throw new ValidationError("'name' supera 200 caracteres");
  }
  if (startDate && dueDate && new Date(dueDate) < new Date(startDate)) {
    throw new ValidationError("dueDate debe ser >= startDate");
  }

  const finalCode = code?.trim() || (await generateProjectCode({ tenantModels }));

  const project = await Project.create({
    name: name.trim(),
    code: finalCode,
    description: description?.trim() ?? null,
    clientId: clientId ?? null,
    status: status ?? "draft",
    priority: priority ?? "medium",
    startDate: startDate ?? null,
    dueDate: dueDate ?? null,
    budgetAmount: budgetAmount ?? null,
    budgetCurrency: budgetCurrency ?? "EUR",
    estimatedHours: estimatedHours ?? null,
    tags: Array.isArray(tags) ? tags : [],
    customFields: customFields ?? {},
  });

  // Crear las 4 columnas Kanban por defecto
  await createDefaultBoardColumns({ projectId: project.id, tenantModels });

  // Auto-asignar al usuario creador como lead si tiene TeamMember
  let isLead = false;
  const ownTeamMember = await findOwnTeamMember({ userId, tenantModels });
  if (ownTeamMember) {
    await tenantModels.ProjectMember.create({
      projectId: project.id,
      teamMemberId: ownTeamMember.id,
      role: "lead",
    });
    isLead = true;
  }

  await auditLog({
    tenantId: tenant.id,
    userId,
    action: "project.created",
    entity: "Project",
    entityId: project.id,
    before: null,
    after: { name: project.name, code: project.code, status: project.status },
    ip: request.headers.get("x-forwarded-for"),
  });

  return created(serializeProject(project, { isAdmin, isLead }));
});
