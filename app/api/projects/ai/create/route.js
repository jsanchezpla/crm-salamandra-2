import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { created, error } from "../../../../../lib/utils/apiResponse.js";
import { ForbiddenError, ValidationError } from "../../../../../lib/utils/errors.js";
import { serializeProject } from "../../../../../lib/projects/serializeProject.js";
import { generateProjectCode } from "../../../../../lib/projects/generateProjectCode.js";
import { createDefaultBoardColumns } from "../../../../../lib/projects/createDefaultBoardColumns.js";
import { isAdminRole, findOwnTeamMember } from "../../../../../lib/projects/projectAuth.js";
import { normalizeChecklistItems } from "../../../../../lib/projects/checklist.js";
import { normalizePlan } from "../../../../../lib/projects/ai/parsePlan.js";
import { getMasterModels } from "../../../../../lib/db/masterDb.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function auditLog(data) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create(data);
  } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/ai/create
//
// Body: { plan, clientId?: uuid, status?: "draft"|"active" (default "draft") }
//
// Materializa en BD un plan generado por /api/projects/ai/generate (y revisado
// por el usuario en la vista previa). El plan se RE-normaliza aquí con
// normalizePlan — nunca se confía en lo que manda el cliente. Mismo criterio
// de rol que el POST manual de /api/projects: sin gate de rol.
//
// Todo se crea en UNA transacción: proyecto, columnas por defecto, fases,
// hitos, tareas (todas a la columna "Por hacer") y miembros. La auditoría
// (project.created con aiGenerated: true) va después, fuera de la transacción.
// ─────────────────────────────────────────────────────────────────────────────
export const POST = withTenant(async (request, _routeContext, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();

  const { tenantModels, tenant, tenantSequelize } = ctx;
  const { Project, Phase, Milestone, Task, TaskAssignee, TeamMember, ProjectMember } = tenantModels;
  const role = request.headers.get("x-user-role");
  const userId = request.headers.get("x-user-id");
  const isAdmin = isAdminRole(role);

  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body JSON inválido");
  }

  const clientId = body?.clientId ?? null;
  if (clientId != null && !UUID_RE.test(clientId)) {
    throw new ValidationError("clientId inválido");
  }
  const status = body?.status === "active" ? "active" : "draft";

  // Re-normalizar SIEMPRE contra el equipo real: los assigneeIds/miembros que
  // no existan se filtran en silencio.
  const teamRows = await TeamMember.findAll({
    where: { status: "active" },
    attributes: ["id", "displayName", "position"],
    raw: true,
  });
  const teamMembers = teamRows.map((m) => ({ id: m.id, name: m.displayName, position: m.position ?? null }));
  const plan = normalizePlan(body?.plan, { teamMembers });

  const code = await generateProjectCode({ tenantModels });
  const ownTeamMember = await findOwnTeamMember({ userId, tenantModels });

  const projectId = await tenantSequelize.transaction(async (t) => {
    // 1. Proyecto (dueDateAfterStartDate ya lo valida el modelo; normalizePlan
    //    ha anulado dueDate si era anterior a startDate).
    const project = await Project.create(
      {
        name: plan.name,
        code,
        description: plan.description,
        clientId,
        status,
        priority: plan.priority,
        startDate: plan.startDate,
        dueDate: plan.dueDate,
        estimatedHours: plan.estimatedHours,
        tags: plan.tags,
        customFields: { aiGenerated: true },
      },
      { transaction: t }
    );

    // 2. Columnas Kanban por defecto (acepta transaction — verificado).
    const columns = await createDefaultBoardColumns({ projectId: project.id, tenantModels, transaction: t });
    const firstColumn = columns.reduce((min, c) => (c.order < min.order ? c : min), columns[0]);

    // 3. Fases con order 0..n-1 (misma base 0 que POST /phases).
    const createdPhases = [];
    for (let i = 0; i < plan.phases.length; i++) {
      const f = plan.phases[i];
      const phase = await Phase.create(
        {
          projectId: project.id,
          name: f.name,
          description: f.description,
          startDate: f.startDate,
          endDate: f.endDate,
          order: i,
        },
        { transaction: t }
      );
      createdPhases.push(phase);
    }

    // 4. Hitos (phaseIndex → phaseId).
    for (const ms of plan.milestones) {
      await Milestone.create(
        {
          projectId: project.id,
          phaseId: ms.phaseIndex != null ? (createdPhases[ms.phaseIndex]?.id ?? null) : null,
          name: ms.name,
          dueDate: ms.dueDate,
          status: "pending",
        },
        { transaction: t }
      );
    }

    // 5. Tareas: todas a la columna "Por hacer" (la de order más bajo), con
    //    order secuencial y sus filas en task_assignees.
    let order = 0;
    for (let i = 0; i < plan.phases.length; i++) {
      for (const taskPlan of plan.phases[i].tasks) {
        const task = await Task.create(
          {
            projectId: project.id,
            boardColumnId: firstColumn.id,
            phaseId: createdPhases[i].id,
            order: order++,
            title: taskPlan.title,
            description: taskPlan.description,
            priority: taskPlan.priority,
            estimatedHours: taskPlan.estimatedHours,
            dueDate: taskPlan.dueDate,
            checklist: normalizeChecklistItems(taskPlan.checklist),
            tags: [],
          },
          { transaction: t }
        );
        if (taskPlan.assigneeIds.length > 0) {
          await TaskAssignee.bulkCreate(
            taskPlan.assigneeIds.map((tmId) => ({ taskId: task.id, teamMemberId: tmId })),
            { transaction: t }
          );
        }
      }
    }

    // 6. Miembros: el creador como lead (igual que el POST manual) + los del
    //    plan. Si el creador ya es lead, cualquier lead del plan se degrada a
    //    member para no duplicar responsables sin querer.
    const creadorEsLead = !!ownTeamMember;
    if (ownTeamMember) {
      await ProjectMember.create(
        { projectId: project.id, teamMemberId: ownTeamMember.id, role: "lead" },
        { transaction: t }
      );
    }
    for (const member of plan.members) {
      if (ownTeamMember && member.teamMemberId === ownTeamMember.id) continue; // ya es lead
      const finalRole = member.role === "lead" && creadorEsLead ? "member" : member.role;
      await ProjectMember.create(
        { projectId: project.id, teamMemberId: member.teamMemberId, role: finalRole },
        { transaction: t }
      );
    }

    return project.id;
  });

  // Auditoría: después de la mutación y FUERA de la transacción.
  const project = await Project.findByPk(projectId);
  await auditLog({
    tenantId: tenant.id,
    userId,
    action: "project.created",
    entity: "Project",
    entityId: projectId,
    before: null,
    after: { name: project.name, code: project.code, status: project.status, aiGenerated: true },
    ip: request.headers.get("x-forwarded-for"),
  });

  return created({ project: serializeProject(project, { isAdmin, isLead: !!ownTeamMember }) });
});
