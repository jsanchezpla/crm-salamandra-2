import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../../lib/utils/apiResponse.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../../../../../lib/utils/errors.js";
import { serializeTask } from "../../../../../lib/projects/serializeTask.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/[id]/board
//
// Vista agregada del Kanban: el proyecto + las columnas con sus tareas
// embebidas (cada tarea con sus assignees). 1 sola query con includes.
//
// Respuesta:
//   {
//     project: { id, name, code, status, ... },
//     columns: [
//       { id, name, order, color, isDoneColumn, wipLimit,
//         tasks: [ { id, title, ..., assignees: [...] }, ... ] }
//     ]
//   }
// ─────────────────────────────────────────────────────────────────────────────
export const GET = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const { tenantModels } = ctx;
  const { Project, BoardColumn, Task, TaskAssignee, TeamMember } = tenantModels;
  const { id: projectId } = await params;

  if (!UUID_RE.test(projectId)) throw new ValidationError("projectId inválido");

  const project = await Project.findByPk(projectId, {
    attributes: ["id", "name", "code", "status", "priority", "archivedAt"],
  });
  if (!project) throw new NotFoundError("Proyecto no encontrado");

  // Cargamos columnas + tareas + asignados en includes anidados. Sequelize
  // emite las queries por separado pero las vincula en memoria; es lo más
  // limpio para una vista de Kanban modesta (< 1000 tareas por proyecto).
  const columns = await BoardColumn.findAll({
    where: { projectId },
    order: [
      ["order", "ASC"],
      [{ model: Task, as: "tasks" }, "order", "ASC"],
    ],
    include: [
      {
        model: Task,
        as: "tasks",
        required: false,
        include: [
          {
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
          },
        ],
      },
    ],
  });

  const data = {
    project: {
      id: project.id,
      name: project.name,
      code: project.code ?? null,
      status: project.status,
      priority: project.priority,
      archivedAt: project.archivedAt ?? null,
    },
    columns: columns.map((col) => {
      const json = col.toJSON();
      const tasks = (json.tasks ?? []).map((t) => {
        const flat = { ...t };
        flat.assignees = (flat.assigneeLinks ?? [])
          .filter((al) => al.teamMember)
          .map((al) => ({
            id: al.teamMember.id,
            displayName: al.teamMember.displayName,
            email: al.teamMember.email,
            avatarUrl: al.teamMember.avatarUrl,
            avatarColor: al.teamMember.avatarColor,
          }));
        delete flat.assigneeLinks;
        return serializeTask(flat);
      });
      return {
        id: json.id,
        name: json.name,
        order: json.order,
        color: json.color ?? null,
        wipLimit: json.wipLimit ?? null,
        isDoneColumn: !!json.isDoneColumn,
        tasks,
      };
    }),
  };

  return ok(data);
});
