import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, created } from "../../../../../lib/utils/apiResponse.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../../../../../lib/utils/errors.js";
import { Op } from "sequelize";
import { serializeTask } from "../../../../../lib/projects/serializeTask.js";
import { isAdminRole, isLeadOfProject } from "../../../../../lib/projects/projectAuth.js";
import { getMasterModels } from "../../../../../lib/db/masterDb.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function auditLog(data) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create(data);
  } catch {}
}

function attachAssignees(include, TaskAssignee, TeamMember) {
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

// Normaliza el include `assigneeLinks` → array plano de team members.
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
// GET /api/projects/[id]/tasks
//
// Query params:
//   - boardColumnId, phaseId, milestoneId: filtros simples por FK.
//   - assigneeId: filtra tareas asignadas a ese team_member (vía task_assignees).
//   - search: filtro iLike en title + description.
//   - tagsAny: CSV. Devuelve tareas que tengan AL MENOS uno de los tags.
//   - limit: max 1000, default 1000 (el Kanban suele caber todo).
// ─────────────────────────────────────────────────────────────────────────────
export const GET = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const { tenantModels } = ctx;
  const { Project, Task, TaskAssignee, TeamMember, BoardColumn } = tenantModels;
  const { id: projectId } = await params;

  if (!UUID_RE.test(projectId)) throw new ValidationError("projectId inválido");

  const project = await Project.findByPk(projectId, { attributes: ["id"] });
  if (!project) throw new NotFoundError("Proyecto no encontrado");

  const { searchParams } = new URL(request.url);
  const boardColumnId = searchParams.get("boardColumnId");
  const phaseId = searchParams.get("phaseId");
  const milestoneId = searchParams.get("milestoneId");
  const assigneeId = searchParams.get("assigneeId");
  const search = searchParams.get("search");
  const tagsAny = searchParams.get("tagsAny");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "1000", 10), 1000);

  const where = { projectId };
  if (boardColumnId) where.boardColumnId = boardColumnId;
  if (phaseId) where.phaseId = phaseId;
  if (milestoneId) where.milestoneId = milestoneId;
  if (search) {
    where[Op.or] = [
      { title: { [Op.iLike]: `%${search}%` } },
      { description: { [Op.iLike]: `%${search}%` } },
    ];
  }
  if (tagsAny) {
    const list = tagsAny.split(",").map((s) => s.trim()).filter(Boolean);
    if (list.length > 0) {
      // JSONB ?| any (overlap). Validamos entradas para evitar inyección:
      // solo se permiten alnum/-/_/espacio.
      const safe = list.filter((tag) => /^[\w\s-]{1,64}$/u.test(tag));
      if (safe.length > 0) {
        where.tags = { [Op.overlap]: safe };
      }
    }
  }

  // Filtro por assignee (task_assignees) — usamos subquery
  if (assigneeId) {
    if (!UUID_RE.test(assigneeId)) throw new ValidationError("assigneeId inválido");
    const links = await TaskAssignee.findAll({
      where: { teamMemberId: assigneeId },
      attributes: ["taskId"],
      raw: true,
    });
    const taskIds = links.map((l) => l.taskId);
    if (taskIds.length === 0) return ok({ tasks: [] });
    where.id = taskIds;
  }

  const rows = await Task.findAll({
    where,
    limit,
    order: [
      ["boardColumnId", "ASC"],
      ["order", "ASC"],
    ],
    include: [
      attachAssignees(null, TaskAssignee, TeamMember),
      { model: BoardColumn, as: "boardColumn", attributes: ["id", "name", "order", "color", "isDoneColumn"], required: false },
    ],
  });

  const tasks = rows.map((r) => serializeTask(flattenAssignees(r.toJSON())));
  return ok({ tasks });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/[id]/tasks
//
// Body: { boardColumnId, phaseId?, milestoneId?, title (req), description?,
//         estimatedHours?, dueDate?, checklist?, tags?, assigneeIds?: [uuid...] }
// ─────────────────────────────────────────────────────────────────────────────
export const POST = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const { tenantModels, tenant, tenantSequelize } = ctx;
  const { Project, Task, TaskAssignee, TeamMember, BoardColumn, Phase, Milestone } = tenantModels;
  const { id: projectId } = await params;

  if (!UUID_RE.test(projectId)) throw new ValidationError("projectId inválido");

  const role = request.headers.get("x-user-role");
  const userId = request.headers.get("x-user-id");
  const isAdmin = isAdminRole(role);
  const isLead = isAdmin
    ? true
    : await isLeadOfProject({ projectId, userId, tenantModels });
  if (!isAdmin && !isLead) {
    throw new ForbiddenError("Solo administradores o el lead del proyecto pueden crear tareas");
  }

  const project = await Project.findByPk(projectId, { attributes: ["id", "archivedAt"] });
  if (!project) throw new NotFoundError("Proyecto no encontrado");
  if (project.archivedAt) throw new ValidationError("Proyecto archivado: no se pueden crear tareas");

  const body = await request.json();
  const {
    boardColumnId,
    phaseId,
    milestoneId,
    title,
    description,
    estimatedHours,
    dueDate,
    checklist,
    tags,
    assigneeIds,
  } = body ?? {};

  if (!title || typeof title !== "string" || title.trim().length === 0) {
    throw new ValidationError("El campo 'title' es obligatorio");
  }
  if (title.trim().length > 255) {
    throw new ValidationError("'title' supera 255 caracteres");
  }
  if (boardColumnId && !UUID_RE.test(boardColumnId)) {
    throw new ValidationError("boardColumnId inválido");
  }

  // Validar pertenencia de columna al proyecto
  if (boardColumnId) {
    const col = await BoardColumn.findOne({
      where: { id: boardColumnId, projectId },
      attributes: ["id"],
    });
    if (!col) throw new ValidationError("La columna no pertenece a este proyecto");
  }

  if (phaseId) {
    if (!UUID_RE.test(phaseId)) throw new ValidationError("phaseId inválido");
    const phase = await Phase.findOne({ where: { id: phaseId, projectId }, attributes: ["id"] });
    if (!phase) throw new ValidationError("La fase no pertenece a este proyecto");
  }
  if (milestoneId) {
    if (!UUID_RE.test(milestoneId)) throw new ValidationError("milestoneId inválido");
    const m = await Milestone.findOne({ where: { id: milestoneId, projectId }, attributes: ["id"] });
    if (!m) throw new ValidationError("El hito no pertenece a este proyecto");
  }

  // Validar assigneeIds
  let validAssigneeIds = [];
  if (Array.isArray(assigneeIds) && assigneeIds.length > 0) {
    const unique = [...new Set(assigneeIds)];
    for (const aid of unique) {
      if (!UUID_RE.test(aid)) throw new ValidationError(`assigneeId inválido: ${aid}`);
    }
    const found = await TeamMember.findAll({
      where: { id: unique },
      attributes: ["id"],
      raw: true,
    });
    const foundIds = new Set(found.map((f) => f.id));
    const missing = unique.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new ValidationError(`team_member(s) no encontrados: ${missing.join(", ")}`);
    }
    validAssigneeIds = unique;
  }

  // Calcular order = max(order) + 1 dentro de la columna
  let nextOrder = 0;
  if (boardColumnId) {
    const maxRow = await Task.findOne({
      where: { projectId, boardColumnId },
      attributes: [[tenantSequelize.fn("MAX", tenantSequelize.col("order")), "maxOrder"]],
      raw: true,
    });
    nextOrder = (maxRow?.maxOrder ?? -1) + 1;
  }

  const taskId = await tenantSequelize.transaction(async (t) => {
    const task = await Task.create(
      {
        projectId,
        boardColumnId: boardColumnId ?? null,
        phaseId: phaseId ?? null,
        milestoneId: milestoneId ?? null,
        order: nextOrder,
        title: title.trim(),
        description: description?.trim() ?? null,
        estimatedHours: estimatedHours ?? null,
        dueDate: dueDate ?? null,
        checklist: Array.isArray(checklist) ? checklist : [],
        tags: Array.isArray(tags) ? tags : [],
      },
      { transaction: t }
    );

    if (validAssigneeIds.length > 0) {
      await TaskAssignee.bulkCreate(
        validAssigneeIds.map((tmId) => ({ taskId: task.id, teamMemberId: tmId })),
        { transaction: t }
      );
    }

    return task.id;
  });

  // Recargar con includes
  const reloaded = await Task.findByPk(taskId, {
    include: [
      attachAssignees(null, TaskAssignee, TeamMember),
      { model: BoardColumn, as: "boardColumn", attributes: ["id", "name", "order", "color", "isDoneColumn"], required: false },
    ],
  });
  const data = serializeTask(flattenAssignees(reloaded.toJSON()));

  await auditLog({
    tenantId: tenant.id,
    userId,
    action: "task.created",
    entity: "Task",
    entityId: taskId,
    before: null,
    after: {
      title: data.title,
      projectId,
      boardColumnId: data.boardColumnId,
      assigneeCount: data.assignees.length,
    },
    ip: request.headers.get("x-forwarded-for"),
  });

  return created(data);
});
