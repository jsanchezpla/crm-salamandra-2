/**
 * Reorganización de proyectos con IA: snapshot compacto para el prompt y
 * validación defensiva de las operaciones que propone el modelo.
 *
 * `buildProjectSnapshot` reduce el proyecto a lo que la IA necesita (ids,
 * nombres y poco más) para no inflar el prompt. `normalizeOperations` valida
 * cada operación contra ese snapshot (ids existentes, enums, fechas),
 * descarta las inválidas anotando `warnings` y añade a cada operación válida
 * una `description` legible en español para la vista previa.
 *
 * El endpoint /ai/apply vuelve a pasar por aquí las operaciones que le llegan
 * del cliente, con un snapshot recién leído de BD: nunca se aplica nada que
 * no valide contra el estado real.
 */

import { NotFoundError, ValidationError } from "../../utils/errors.js";
import { priorityMeta } from "../taskPriority.js";

const MAX_SNAPSHOT_TASKS = 200;

const PRIORITY_VALUES = ["low", "medium", "high", "urgent"];
const STATUS_VALUES = ["draft", "active", "paused", "completed", "cancelled"];
const MEMBER_ROLES = ["lead", "member", "viewer"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CHECKLIST = 15;

const ROLE_LABELS = { lead: "responsable (lead)", member: "miembro", viewer: "observador" };

function toText(value, max = null) {
  if (typeof value !== "string") return "";
  const t = value.trim();
  return max != null ? t.slice(0, max) : t;
}

function toDateOnly(value) {
  if (typeof value !== "string" || !DATE_RE.test(value.trim())) return null;
  const t = value.trim();
  const d = new Date(`${t}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10) === t ? t : null;
}

function toHours(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Snapshot compacto del proyecto para el prompt de edición.
 *
 * Espera instancias/POJOs ya cargados por el caller:
 *   - project: Project
 *   - phases: Phase[] (ordenadas por order ASC)
 *   - columns: BoardColumn[] (ordenadas por order ASC)
 *   - tasks: Task[] con `assignees` ya aplanados (ordenadas por createdAt ASC)
 *   - members: ProjectMember[] con include `teamMember`
 *   - teamMembers: [{ id, name, position }] (equipo completo del tenant)
 *
 * Lanza ValidationError si el proyecto supera las 200 tareas (el prompt se
 * dispararía de tamaño y la propuesta dejaría de ser fiable).
 */
export function buildProjectSnapshot({
  project,
  phases = [],
  columns = [],
  tasks = [],
  members = [],
  teamMembers = [],
}) {
  if (tasks.length > MAX_SNAPSHOT_TASKS) {
    throw new ValidationError(
      `Este proyecto tiene ${tasks.length} tareas y la reorganización con IA admite un máximo de ${MAX_SNAPSHOT_TASKS}. Divide el proyecto o haz los cambios a mano.`
    );
  }

  const p = typeof project.toJSON === "function" ? project.toJSON() : project;
  const phaseName = new Map(phases.map((f) => [f.id, f.name]));
  const columnName = new Map(columns.map((c) => [c.id, c.name]));

  return {
    project: {
      id: p.id,
      name: p.name,
      description: p.description ?? null,
      status: p.status,
      priority: p.priority,
      startDate: p.startDate ?? null,
      dueDate: p.dueDate ?? null,
    },
    phases: phases.map((f) => ({
      id: f.id,
      name: f.name,
      order: f.order,
      startDate: f.startDate ?? null,
      endDate: f.endDate ?? null,
    })),
    columns: columns.map((c) => ({
      id: c.id,
      name: c.name,
      order: c.order,
      isDoneColumn: !!c.isDoneColumn,
    })),
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      columnId: t.boardColumnId ?? null,
      column: t.boardColumnId ? (columnName.get(t.boardColumnId) ?? null) : null,
      phaseId: t.phaseId ?? null,
      phase: t.phaseId ? (phaseName.get(t.phaseId) ?? null) : null,
      priority: t.priority ?? "medium",
      dueDate: t.dueDate ?? null,
      assignees: (t.assignees ?? []).map((a) => a.displayName).filter(Boolean),
      assigneeIds: (t.assignees ?? []).map((a) => a.teamMemberId ?? a.id).filter(Boolean),
    })),
    members: members.map((m) => ({
      teamMemberId: m.teamMemberId,
      name: m.teamMember?.displayName ?? null,
      role: m.role,
    })),
    team: (teamMembers ?? []).map((m) => ({
      id: m.id,
      name: m.name ?? m.displayName ?? "",
      position: m.position ?? null,
    })),
  };
}

/**
 * Carga de BD todo lo que necesita el snapshot y lo construye. Lo comparten
 * /ai/edit (para el prompt) y /ai/apply (para RE-validar contra el estado
 * real). Lanza NotFoundError si el proyecto no existe.
 *
 * Devuelve { project, snapshot }.
 */
export async function loadProjectSnapshot({ projectId, tenantModels }) {
  const { Project, Phase, BoardColumn, Task, TaskAssignee, TeamMember, ProjectMember } =
    tenantModels;

  const project = await Project.findByPk(projectId);
  if (!project) throw new NotFoundError("Proyecto no encontrado");

  const [phases, columns, taskRows, members, teamRows] = await Promise.all([
    Phase.findAll({ where: { projectId }, order: [["order", "ASC"]] }),
    BoardColumn.findAll({ where: { projectId }, order: [["order", "ASC"]] }),
    Task.findAll({
      where: { projectId },
      order: [["createdAt", "ASC"]],
      include: [
        {
          model: TaskAssignee,
          as: "assigneeLinks",
          required: false,
          include: [{ model: TeamMember, as: "teamMember", attributes: ["id", "displayName"] }],
        },
      ],
    }),
    ProjectMember.findAll({
      where: { projectId },
      include: [{ model: TeamMember, as: "teamMember", attributes: ["id", "displayName"] }],
    }),
    TeamMember.findAll({
      where: { status: "active" },
      attributes: ["id", "displayName", "position"],
      order: [["displayName", "ASC"]],
      raw: true,
    }),
  ]);

  const tasks = taskRows.map((row) => {
    const t = row.toJSON();
    t.assignees = (t.assigneeLinks ?? [])
      .filter((al) => al.teamMember)
      .map((al) => ({ teamMemberId: al.teamMember.id, displayName: al.teamMember.displayName }));
    delete t.assigneeLinks;
    return t;
  });

  const teamMembers = teamRows.map((m) => ({
    id: m.id,
    name: m.displayName,
    position: m.position ?? null,
  }));

  const snapshot = buildProjectSnapshot({ project, phases, columns, tasks, members, teamMembers });
  return { project, snapshot };
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalización de operaciones
// ─────────────────────────────────────────────────────────────────────────────

function nombresDeEquipo(ids, teamById) {
  const nombres = ids.map((id) => teamById.get(id)?.name).filter(Boolean);
  if (nombres.length === 0) return "";
  return nombres.join(", ");
}

function describirCambios(changes, { teamById } = {}) {
  const partes = [];
  if (changes.name !== undefined) partes.push(`nombre → «${changes.name}»`);
  if (changes.title !== undefined) partes.push(`título → «${changes.title}»`);
  if (changes.description !== undefined) partes.push("nueva descripción");
  if (changes.priority !== undefined)
    partes.push(`prioridad → ${priorityMeta(changes.priority).label}`);
  if (changes.status !== undefined) partes.push(`estado → ${changes.status}`);
  if (changes.startDate !== undefined)
    partes.push(`fecha de inicio → ${changes.startDate ?? "sin fecha"}`);
  if (changes.dueDate !== undefined)
    partes.push(`fecha límite → ${changes.dueDate ?? "sin fecha"}`);
  if (changes.endDate !== undefined)
    partes.push(`fecha de fin → ${changes.endDate ?? "sin fecha"}`);
  if (changes.estimatedHours !== undefined)
    partes.push(`horas estimadas → ${changes.estimatedHours ?? "sin estimar"}`);
  if (changes.phaseId !== undefined) partes.push(changes.phaseId ? "cambio de fase" : "sin fase");
  if (changes.boardColumnId !== undefined) partes.push("cambio de columna");
  if (changes.assigneeIds !== undefined) {
    const nombres = teamById ? nombresDeEquipo(changes.assigneeIds, teamById) : "";
    partes.push(
      changes.assigneeIds.length === 0
        ? "sin asignados"
        : `asignados → ${nombres || `${changes.assigneeIds.length} personas`}`
    );
  }
  return partes.join(", ");
}

/**
 * Valida las operaciones propuestas (por la IA o reenviadas por el cliente)
 * contra el snapshot. Devuelve `{ operations, warnings }`: las inválidas se
 * descartan anotando un warning en español; las válidas salen con la forma
 * canónica + un campo `description` legible para la vista previa. Dentro de
 * una actualización, un campo inválido se ignora (también con warning) y solo
 * el null explícito quita lo que había.
 */
export function normalizeOperations(raw, snapshot) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.operations) ? raw.operations : null;
  const warnings = [];
  const operations = [];
  if (!list) {
    warnings.push("La propuesta no contiene una lista de operaciones.");
    return { operations, warnings };
  }

  const phaseById = new Map((snapshot.phases ?? []).map((f) => [f.id, f]));
  const columnById = new Map((snapshot.columns ?? []).map((c) => [c.id, c]));
  const taskById = new Map((snapshot.tasks ?? []).map((t) => [t.id, t]));
  const teamById = new Map((snapshot.team ?? []).map((m) => [m.id, m]));
  const memberIds = new Set((snapshot.members ?? []).map((m) => m.teamMemberId));

  const descarta = (op, motivo) => {
    warnings.push(`Se ha descartado una operación «${op?.op ?? "desconocida"}»: ${motivo}`);
  };

  const filtraAsignados = (value) => {
    if (!Array.isArray(value)) return [];
    const out = [];
    for (const rawId of value) {
      if (typeof rawId !== "string") continue;
      const id = rawId.trim();
      if (!UUID_RE.test(id) || !teamById.has(id) || out.includes(id)) continue;
      out.push(id);
    }
    return out;
  };

  // 19/08/2026 — lo sacó _smoke-projects-ai-parsePlan-editOps.mjs: en una
  // actualización (updateProject/updatePhase/updateTask) una fecha, unas horas,
  // una descripción o unos asignados INVÁLIDOS entraban en `changes` como
  // null/[] y, al aplicar, borraban lo que había. El modelo quería poner, no
  // quitar. Ahora se IGNORAN avisando, como ya pasaba con priority/status
  // fuera del enum y con phaseId/boardColumnId desconocidos; solo el null
  // EXPLÍCITO sigue significando «quitar». `sujeto` es «el proyecto», «la fase
  // «X»» o «la tarea «X»», para que el aviso diga de quién habla.
  const ignora = (sujeto, campo, motivo) => {
    warnings.push(`Al actualizar ${sujeto} se ha ignorado el campo «${campo}»: ${motivo}`);
  };
  const ponDescripcion = (sujeto, changes, c) => {
    if (c.description === undefined) return;
    if (c.description === null) changes.description = null;
    else if (typeof c.description !== "string") ignora(sujeto, "descripción", "no es texto");
    else changes.description = toText(c.description) || null;
  };
  const ponFecha = (sujeto, changes, c, campo, etiqueta) => {
    if (c[campo] === undefined) return;
    if (c[campo] === null) changes[campo] = null;
    else {
      const fecha = toDateOnly(c[campo]);
      if (fecha) changes[campo] = fecha;
      else ignora(sujeto, etiqueta, "no es una fecha válida (AAAA-MM-DD)");
    }
  };
  const ponHoras = (sujeto, changes, c) => {
    if (c.estimatedHours === undefined) return;
    if (c.estimatedHours === null) changes.estimatedHours = null;
    else {
      const horas = toHours(c.estimatedHours);
      if (horas != null) changes.estimatedHours = horas;
      else ignora(sujeto, "horas estimadas", "no es un número de horas válido");
    }
  };
  const ponAsignados = (sujeto, changes, c) => {
    if (c.assigneeIds === undefined) return;
    if (!Array.isArray(c.assigneeIds)) {
      ignora(sujeto, "asignados", "no es una lista de ids");
      return;
    }
    const ids = filtraAsignados(c.assigneeIds);
    const desconocidos = c.assigneeIds.filter(
      (id) => typeof id !== "string" || !teamById.has(id.trim())
    ).length;
    if (desconocidos > 0 && ids.length === 0) {
      ignora(sujeto, "asignados", "ninguno de los ids es del equipo");
      return;
    }
    if (desconocidos > 0) {
      warnings.push(
        `Al actualizar ${sujeto} se han quitado del campo «asignados» ${
          desconocidos === 1 ? "1 id que no es" : `${desconocidos} ids que no son`
        } del equipo`
      );
    }
    changes.assigneeIds = ids;
  };

  for (const rawOp of list) {
    if (!rawOp || typeof rawOp !== "object" || typeof rawOp.op !== "string") {
      descarta(rawOp, "no tiene una forma reconocible");
      continue;
    }

    switch (rawOp.op) {
      case "updateProject": {
        const c = rawOp.changes && typeof rawOp.changes === "object" ? rawOp.changes : {};
        const changes = {};
        if (c.name !== undefined) {
          const name = toText(c.name, 200);
          if (name) changes.name = name;
        }
        ponDescripcion("el proyecto", changes, c);
        if (c.priority !== undefined && PRIORITY_VALUES.includes(c.priority))
          changes.priority = c.priority;
        if (c.status !== undefined && STATUS_VALUES.includes(c.status)) changes.status = c.status;
        ponFecha("el proyecto", changes, c, "startDate", "fecha de inicio");
        ponFecha("el proyecto", changes, c, "dueDate", "fecha límite");
        if (Object.keys(changes).length === 0) {
          descarta(rawOp, "no incluye ningún cambio válido");
          break;
        }
        operations.push({
          op: "updateProject",
          changes,
          description: `Actualizar el proyecto: ${describirCambios(changes)}`,
        });
        break;
      }

      case "createPhase": {
        const name = toText(rawOp.name, 200);
        if (!name) {
          descarta(rawOp, "la fase no tiene nombre");
          break;
        }
        const startDate = toDateOnly(rawOp.startDate);
        let endDate = toDateOnly(rawOp.endDate);
        if (startDate && endDate && endDate < startDate) endDate = null;
        // La descripción DE LA FASE viaja en `phaseDescription`: el campo
        // `description` de todas las ops queda reservado para la etiqueta
        // legible de la vista previa. En la re-validación de /ai/apply la op
        // ya viene con esa etiqueta en `description`, así que si existe la
        // clave `phaseDescription` manda ella (aunque sea null).
        operations.push({
          op: "createPhase",
          name,
          phaseDescription:
            toText("phaseDescription" in rawOp ? rawOp.phaseDescription : rawOp.description) ||
            null,
          startDate,
          endDate,
          description: `Crear la fase «${name}»`,
        });
        break;
      }

      case "updatePhase": {
        const phase = phaseById.get(rawOp.phaseId);
        if (!phase) {
          descarta(rawOp, "la fase indicada no existe en el proyecto");
          break;
        }
        const c = rawOp.changes && typeof rawOp.changes === "object" ? rawOp.changes : {};
        const changes = {};
        if (c.name !== undefined) {
          const name = toText(c.name, 200);
          if (name) changes.name = name;
        }
        const sujeto = `la fase «${phase.name}»`;
        ponDescripcion(sujeto, changes, c);
        ponFecha(sujeto, changes, c, "startDate", "fecha de inicio");
        ponFecha(sujeto, changes, c, "endDate", "fecha de fin");
        if (Object.keys(changes).length === 0) {
          descarta(rawOp, "no incluye ningún cambio válido");
          break;
        }
        operations.push({
          op: "updatePhase",
          phaseId: phase.id,
          changes,
          description: `Actualizar la fase «${phase.name}»: ${describirCambios(changes)}`,
        });
        break;
      }

      case "deletePhase": {
        const phase = phaseById.get(rawOp.phaseId);
        if (!phase) {
          descarta(rawOp, "la fase indicada no existe en el proyecto");
          break;
        }
        operations.push({
          op: "deletePhase",
          phaseId: phase.id,
          description: `Eliminar la fase «${phase.name}» (sus tareas quedan sin fase)`,
        });
        break;
      }

      case "createTask": {
        const title = toText(rawOp.title, 255);
        if (!title) {
          descarta(rawOp, "la tarea no tiene título");
          break;
        }
        let phaseId = null;
        if (rawOp.phaseId != null) {
          const phase = phaseById.get(rawOp.phaseId);
          if (!phase) {
            descarta(rawOp, "la fase indicada no existe en el proyecto");
            break;
          }
          phaseId = phase.id;
        }
        const assigneeIds = filtraAsignados(rawOp.assigneeIds);
        const checklist = Array.isArray(rawOp.checklist)
          ? rawOp.checklist
              .map((s) => (typeof s === "string" ? s.trim() : ""))
              .filter(Boolean)
              .slice(0, MAX_CHECKLIST)
          : [];
        const donde = phaseId ? ` en la fase «${phaseById.get(phaseId).name}»` : "";
        const nombres = nombresDeEquipo(assigneeIds, teamById);
        const asignada = nombres ? `, asignada a ${nombres}` : "";
        // Mismo criterio que en createPhase: la descripción DE LA TAREA viaja
        // en `taskDescription`; `description` es la etiqueta de vista previa.
        operations.push({
          op: "createTask",
          phaseId,
          title,
          taskDescription:
            toText("taskDescription" in rawOp ? rawOp.taskDescription : rawOp.description) || null,
          priority: PRIORITY_VALUES.includes(rawOp.priority) ? rawOp.priority : "medium",
          dueDate: toDateOnly(rawOp.dueDate),
          estimatedHours: toHours(rawOp.estimatedHours),
          assigneeIds,
          checklist,
          description: `Crear la tarea «${title}»${donde}${asignada}`,
        });
        break;
      }

      case "updateTask": {
        const task = taskById.get(rawOp.taskId);
        if (!task) {
          descarta(rawOp, "la tarea indicada no existe en el proyecto");
          break;
        }
        const c = rawOp.changes && typeof rawOp.changes === "object" ? rawOp.changes : {};
        const changes = {};
        if (c.title !== undefined) {
          const title = toText(c.title, 255);
          if (title) changes.title = title;
        }
        const sujeto = `la tarea «${task.title}»`;
        ponDescripcion(sujeto, changes, c);
        if (c.priority !== undefined && PRIORITY_VALUES.includes(c.priority))
          changes.priority = c.priority;
        ponFecha(sujeto, changes, c, "dueDate", "fecha límite");
        ponHoras(sujeto, changes, c);
        if (c.phaseId !== undefined) {
          if (c.phaseId === null) changes.phaseId = null;
          else if (phaseById.has(c.phaseId)) changes.phaseId = c.phaseId;
        }
        if (c.boardColumnId !== undefined && columnById.has(c.boardColumnId)) {
          changes.boardColumnId = c.boardColumnId;
        }
        ponAsignados(sujeto, changes, c);
        if (Object.keys(changes).length === 0) {
          descarta(rawOp, "no incluye ningún cambio válido");
          break;
        }
        let detalle = describirCambios(changes, { teamById });
        if (changes.boardColumnId !== undefined) {
          detalle = detalle.replace(
            "cambio de columna",
            `columna → «${columnById.get(changes.boardColumnId).name}»`
          );
        }
        if (changes.phaseId) {
          detalle = detalle.replace(
            "cambio de fase",
            `fase → «${phaseById.get(changes.phaseId).name}»`
          );
        }
        operations.push({
          op: "updateTask",
          taskId: task.id,
          changes,
          description: `Actualizar la tarea «${task.title}»: ${detalle}`,
        });
        break;
      }

      case "deleteTask": {
        const task = taskById.get(rawOp.taskId);
        if (!task) {
          descarta(rawOp, "la tarea indicada no existe en el proyecto");
          break;
        }
        operations.push({
          op: "deleteTask",
          taskId: task.id,
          description: `Eliminar la tarea «${task.title}»`,
        });
        break;
      }

      case "addMember": {
        const tm = teamById.get(rawOp.teamMemberId);
        if (!tm) {
          descarta(rawOp, "la persona indicada no existe en el equipo");
          break;
        }
        if (memberIds.has(tm.id)) {
          descarta(rawOp, `${tm.name || "esa persona"} ya es miembro del proyecto`);
          break;
        }
        const role = MEMBER_ROLES.includes(rawOp.role) ? rawOp.role : "member";
        operations.push({
          op: "addMember",
          teamMemberId: tm.id,
          role,
          description: `Añadir a ${tm.name || "una persona del equipo"} al proyecto como ${ROLE_LABELS[role]}`,
        });
        break;
      }

      case "removeMember": {
        const tm = teamById.get(rawOp.teamMemberId);
        if (!tm || !memberIds.has(rawOp.teamMemberId)) {
          descarta(rawOp, "la persona indicada no es miembro del proyecto");
          break;
        }
        operations.push({
          op: "removeMember",
          teamMemberId: tm.id,
          description: `Quitar a ${tm.name || "una persona"} del proyecto`,
        });
        break;
      }

      default:
        descarta(rawOp, "tipo de operación no soportado");
    }
  }

  return { operations, warnings };
}
