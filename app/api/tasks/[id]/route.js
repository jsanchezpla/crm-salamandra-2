import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, noContent } from "../../../../lib/utils/apiResponse.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../../../../lib/utils/errors.js";
import { serializeTask } from "../../../../lib/projects/serializeTask.js";
import { isAdminRole, isLeadOfProject } from "../../../../lib/projects/projectAuth.js";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { isValidTaskPriority, TASK_PRIORITY_VALUES } from "../../../../lib/projects/taskPriority.js";
import { normalizeChecklistItems } from "../../../../lib/projects/checklist.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EDITABLE_FIELDS = new Set([
  "title",
  "description",
  "priority",
  "boardColumnId",
  "phaseId",
  "milestoneId",
  "estimatedHours",
  "dueDate",
  "checklist",
  "tags",
  "customFields",
]);

async function auditLog(data) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create(data);
  } catch {}
}

function attachAssigneesInclude(TaskAssignee, TeamMember) {
  return {
    model: TaskAssignee,
    as: "assigneeLinks",
    required: false,
    include: [
      {
        model: TeamMember,
        as: "teamMember",
        attributes: ["id", "displayName", "email", "avatarUrl", "avatarColor"],
      },
    ],
  };
}

function flattenAssignees(taskJson) {
  if (!Array.isArray(taskJson.assigneeLinks)) return taskJson;
  taskJson.assignees = taskJson.assigneeLinks
    .filter((al) => al.teamMember)
    .map((al) => ({
      id: al.teamMember.id,
      displayName: al.teamMember.displayName,
      email: al.teamMember.email,
      avatarUrl: al.teamMember.avatarUrl,
      avatarColor: al.teamMember.avatarColor,
    }));
  delete taskJson.assigneeLinks;
  return taskJson;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tasks/[id]
// ─────────────────────────────────────────────────────────────────────────────
export const GET = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const { tenantModels } = ctx;
  const { Task, TaskAssignee, TeamMember, BoardColumn, Project, Phase, Milestone } = tenantModels;
  const { id } = await params;

  if (!UUID_RE.test(id)) throw new ValidationError("id inválido");

  const task = await Task.findByPk(id, {
    include: [
      attachAssigneesInclude(TaskAssignee, TeamMember),
      { model: BoardColumn, as: "boardColumn", attributes: ["id", "name", "order", "color", "isDoneColumn"], required: false },
      { model: Project, as: "project", attributes: ["id", "name", "code"], required: false },
      { model: Phase, as: "phase", attributes: ["id", "name", "order"], required: false },
      { model: Milestone, as: "milestone", attributes: ["id", "name", "dueDate", "status"], required: false },
    ],
  });
  if (!task) throw new NotFoundError("Tarea no encontrada");

  return ok(serializeTask(flattenAssignees(task.toJSON())));
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/tasks/[id]
//
// Body: subset de EDITABLE_FIELDS + assigneeIds? (reemplaza la lista).
// `order` NO se modifica aquí — usar /move o /reorder-tasks.
// ─────────────────────────────────────────────────────────────────────────────
export const PATCH = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const { tenantModels, tenant, tenantSequelize } = ctx;
  const { Task, TaskAssignee, TeamMember, BoardColumn, Project, Phase, Milestone } = tenantModels;
  const { id } = await params;

  if (!UUID_RE.test(id)) throw new ValidationError("id inválido");

  const role = request.headers.get("x-user-role");
  const userId = request.headers.get("x-user-id");
  const isAdmin = isAdminRole(role);

  const task = await Task.findByPk(id);
  if (!task) throw new NotFoundError("Tarea no encontrada");

  const isLead = isAdmin
    ? true
    : await isLeadOfProject({ projectId: task.projectId, userId, tenantModels });
  if (!isAdmin && !isLead) {
    throw new ForbiddenError("Solo administradores o el lead del proyecto pueden editar tareas");
  }

  const body = (await request.json()) ?? {};
  const updates = {};
  for (const key of Object.keys(body)) {
    if (EDITABLE_FIELDS.has(key)) updates[key] = body[key];
  }

  // Validaciones específicas
  if (updates.title != null) {
    if (typeof updates.title !== "string" || updates.title.trim().length === 0) {
      throw new ValidationError("'title' no puede estar vacío");
    }
    if (updates.title.trim().length > 255) {
      throw new ValidationError("'title' supera 255 caracteres");
    }
    updates.title = updates.title.trim();
  }
  if (updates.description != null && typeof updates.description === "string") {
    updates.description = updates.description.trim();
  }
  if (updates.priority !== undefined && !isValidTaskPriority(updates.priority)) {
    throw new ValidationError(`'priority' inválida. Opciones: ${TASK_PRIORITY_VALUES.join(", ")}`);
  }

  // Checklist: normaliza ids (evita el bug de "marcar uno marca todos" y
  // persiste un shape limpio { id, text, done }).
  if (updates.checklist !== undefined) {
    updates.checklist = normalizeChecklistItems(updates.checklist);
  }

  // Si cambia la columna, validar que sigue siendo del MISMO proyecto. NO
  // mover de proyecto vía PATCH.
  if (updates.boardColumnId !== undefined && updates.boardColumnId !== null) {
    if (!UUID_RE.test(updates.boardColumnId)) {
      throw new ValidationError("boardColumnId inválido");
    }
    const col = await BoardColumn.findOne({
      where: { id: updates.boardColumnId, projectId: task.projectId },
      attributes: ["id"],
    });
    if (!col) {
      throw new ValidationError("La columna destino no pertenece al mismo proyecto");
    }
  }

  if (updates.phaseId !== undefined && updates.phaseId !== null) {
    if (!UUID_RE.test(updates.phaseId)) throw new ValidationError("phaseId inválido");
    const phase = await Phase.findOne({
      where: { id: updates.phaseId, projectId: task.projectId },
      attributes: ["id"],
    });
    if (!phase) throw new ValidationError("La fase no pertenece al mismo proyecto");
  }

  if (updates.milestoneId !== undefined && updates.milestoneId !== null) {
    if (!UUID_RE.test(updates.milestoneId)) throw new ValidationError("milestoneId inválido");
    const m = await Milestone.findOne({
      where: { id: updates.milestoneId, projectId: task.projectId },
      attributes: ["id"],
    });
    if (!m) throw new ValidationError("El hito no pertenece al mismo proyecto");
  }

  // assigneeIds (opcional) — reemplaza la lista completa
  let replaceAssignees = null;
  if (Array.isArray(body.assigneeIds)) {
    const unique = [...new Set(body.assigneeIds)];
    for (const aid of unique) {
      if (!UUID_RE.test(aid)) throw new ValidationError(`assigneeId inválido: ${aid}`);
    }
    if (unique.length > 0) {
      const found = await TeamMember.findAll({
        where: { id: unique },
        attributes: ["id"],
        raw: true,
      });
      const foundIds = new Set(found.map((f) => f.id));
      const missing = unique.filter((aid) => !foundIds.has(aid));
      if (missing.length > 0) {
        throw new ValidationError(`team_member(s) no encontrados: ${missing.join(", ")}`);
      }
    }
    replaceAssignees = unique;
  }

  const before = {
    title: task.title,
    boardColumnId: task.boardColumnId,
    phaseId: task.phaseId,
    milestoneId: task.milestoneId,
    dueDate: task.dueDate,
  };

  await tenantSequelize.transaction(async (t) => {
    if (Object.keys(updates).length > 0) {
      await task.update(updates, { transaction: t });
    }
    if (replaceAssignees !== null) {
      await TaskAssignee.destroy({ where: { taskId: task.id }, transaction: t });
      if (replaceAssignees.length > 0) {
        await TaskAssignee.bulkCreate(
          replaceAssignees.map((tmId) => ({ taskId: task.id, teamMemberId: tmId })),
          { transaction: t }
        );
      }
    }
  });

  // Recargar con includes
  const reloaded = await Task.findByPk(id, {
    include: [
      attachAssigneesInclude(TaskAssignee, TeamMember),
      { model: BoardColumn, as: "boardColumn", attributes: ["id", "name", "order", "color", "isDoneColumn"], required: false },
      { model: Project, as: "project", attributes: ["id", "name", "code"], required: false },
      { model: Phase, as: "phase", attributes: ["id", "name", "order"], required: false },
      { model: Milestone, as: "milestone", attributes: ["id", "name", "dueDate", "status"], required: false },
    ],
  });
  const data = serializeTask(flattenAssignees(reloaded.toJSON()));

  await auditLog({
    tenantId: tenant.id,
    userId,
    action: "task.updated",
    entity: "Task",
    entityId: id,
    before,
    after: {
      title: data.title,
      boardColumnId: data.boardColumnId,
      phaseId: data.phaseId,
      milestoneId: data.milestoneId,
      dueDate: data.dueDate,
      assigneesChanged: replaceAssignees !== null,
    },
    ip: request.headers.get("x-forwarded-for"),
  });

  return ok(data);
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/tasks/[id]
//
// Hard delete. CASCADE de task_assignees se encarga del cleanup. Coherente
// con Phase / Milestone que también son hard delete en este módulo.
// ─────────────────────────────────────────────────────────────────────────────
export const DELETE = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const { tenantModels, tenant, tenantSequelize } = ctx;
  const { Task } = tenantModels;
  const { id } = await params;

  if (!UUID_RE.test(id)) throw new ValidationError("id inválido");

  const role = request.headers.get("x-user-role");
  const userId = request.headers.get("x-user-id");
  const isAdmin = isAdminRole(role);

  const task = await Task.findByPk(id);
  if (!task) throw new NotFoundError("Tarea no encontrada");

  const isLead = isAdmin
    ? true
    : await isLeadOfProject({ projectId: task.projectId, userId, tenantModels });
  if (!isAdmin && !isLead) {
    throw new ForbiddenError("Solo administradores o el lead del proyecto pueden borrar tareas");
  }

  const before = {
    title: task.title,
    projectId: task.projectId,
    boardColumnId: task.boardColumnId,
    order: task.order,
  };

  // Borrar + compactar order del resto de tareas de la columna
  await tenantSequelize.transaction(async (t) => {
    const { boardColumnId, projectId, order } = task;
    await task.destroy({ transaction: t });
    if (boardColumnId != null) {
      await Task.decrement("order", {
        by: 1,
        where: {
          projectId,
          boardColumnId,
          order: { [Op.gt]: order },
        },
        transaction: t,
      });
    }
  });

  await auditLog({
    tenantId: tenant.id,
    userId,
    action: "task.deleted",
    entity: "Task",
    entityId: id,
    before,
    after: null,
    ip: request.headers.get("x-forwarded-for"),
  });

  return noContent();
});
