import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { created, forbidden } from "../../../../../lib/utils/apiResponse.js";
import { NotFoundError, ForbiddenError, ValidationError } from "../../../../../lib/utils/errors.js";
import { generateProjectCode } from "../../../../../lib/projects/generateProjectCode.js";
import { createDefaultBoardColumns } from "../../../../../lib/projects/createDefaultBoardColumns.js";
import { serializeProject } from "../../../../../lib/projects/serializeProject.js";
import { isAdminRole, findOwnTeamMember } from "../../../../../lib/projects/projectAuth.js";
import { getMasterModels } from "../../../../../lib/db/masterDb.js";

const TERMINAL_POSITIVE_STAGES = new Set(["won", "closed_yes"]);

async function auditLog(data) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create(data);
  } catch {}
}

export const POST = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("leads") && !ctx.hasModule("sales")) throw new ForbiddenError();
  if (!ctx.hasModule("projects")) {
    throw new ForbiddenError("El módulo 'projects' no está activo en este tenant");
  }

  const { tenantModels, tenant } = ctx;
  const { Lead, Project, ProjectMember } = tenantModels;
  const { id } = await params;

  const role = request.headers.get("x-user-role");
  const userId = request.headers.get("x-user-id");
  const isAdmin = isAdminRole(role);

  const lead = await Lead.findByPk(id);
  if (!lead) throw new NotFoundError("Lead no encontrado");

  if (lead.convertedProjectId) {
    throw new ValidationError("Este lead ya está convertido en proyecto");
  }

  const body = await request.json().catch(() => ({}));
  const {
    name,
    description,
    budgetAmount,
    budgetCurrency,
    startDate,
    dueDate,
    priority,
    // templateId reservado para Sprint 3
  } = body;

  const finalName = (name?.trim() || lead.title || lead.name || "Proyecto sin nombre").slice(0, 200);
  const finalCode = await generateProjectCode({ tenantModels });

  const sequelize = Project.sequelize;
  const project = await sequelize.transaction(async (t) => {
    const p = await Project.create({
      name: finalName,
      code: finalCode,
      description: description ?? lead.notes ?? null,
      clientId: lead.clientId ?? null,
      status: "active",
      priority: priority ?? "medium",
      startDate: startDate ?? null,
      dueDate: dueDate ?? null,
      budgetAmount: budgetAmount ?? lead.value ?? null,
      budgetCurrency: budgetCurrency ?? "EUR",
      tags: [],
      customFields: { convertedFromLeadId: lead.id },
    }, { transaction: t });

    await createDefaultBoardColumns({ projectId: p.id, tenantModels, transaction: t });

    // Auto-asignar al usuario creador como lead si tiene TeamMember
    const ownTeamMember = await findOwnTeamMember({ userId, tenantModels });
    if (ownTeamMember) {
      await ProjectMember.create({
        projectId: p.id,
        teamMemberId: ownTeamMember.id,
        role: "lead",
      }, { transaction: t });
    }

    // Marcar lead como convertido y, si stage no es terminal positivo, ponerlo a 'won'
    const updates = {
      convertedProjectId: p.id,
      convertedToProjectAt: new Date(),
    };
    if (!TERMINAL_POSITIVE_STAGES.has(lead.stage)) {
      updates.stage = "won";
    }
    await lead.update(updates, { transaction: t });

    return p;
  });

  await auditLog({
    tenantId: tenant.id,
    userId,
    action: "project.lead_converted",
    entity: "Project",
    entityId: project.id,
    before: null,
    after: { leadId: lead.id, projectId: project.id, projectCode: project.code, leadStageAfter: lead.stage },
    ip: request.headers.get("x-forwarded-for"),
  });

  return created(serializeProject(project, { isAdmin, isLead: true }));
});
