/**
 * lib/calendar/projectEvents.js — conecta el CALENDARIO con el módulo PROYECTOS.
 *
 * El calendario del equipo era mono-fuente (solo calendar_tasks); las fechas de
 * los proyectos (dueDate de tarjetas Kanban e hitos) no se veían en ningún
 * calendario. Este helper las sirve como eventos de FullCalendar de SOLO
 * LECTURA-visual (id prefijado, extendedProps.kind) para que el feed
 * /api/calendar/tasks las mezcle cuando el tenant tiene el módulo projects.
 * El frontend distingue por `kind`: clic → enlace al proyecto (no abre el modal
 * de tarea) y arrastrar → PATCH del dueDate real en proyectos.
 *
 * (Fichero nuevo en /lib, regla #2.)
 */
import { Op } from "sequelize";

// Colores: tarjeta = color de su columna Kanban (Por hacer/En curso/...); hito
// por estado. Fallbacks alineados con la paleta del seed de proyectos.
const TASK_FALLBACK = "#6366F1";
const MILESTONE_COLORS = { pending: "#8B5CF6", completed: "#94A3B8", missed: "#EF4444" };

/**
 * Eventos de proyectos (tarjetas con dueDate + hitos) entre dos fechas.
 * Devuelve [] si el tenant no tiene el módulo projects o si faltan modelos.
 * Nunca lanza: el calendario no debe caerse por un fallo en proyectos.
 */
export async function fetchProjectEvents({ tenantModels, hasModule, start, end }) {
  try {
    if (!hasModule || !hasModule("projects")) return [];
    const { Task, Milestone, Project, BoardColumn } = tenantModels;
    if (!Task || !Project) return [];

    const range = start && end ? { [Op.between]: [start, end] } : start ? { [Op.gte]: start } : null;
    if (!range) return [];

    // Solo proyectos vivos (ni archivados ni cancelados).
    const projectInclude = {
      model: Project,
      as: "project",
      attributes: ["id", "name", "code", "status"],
      where: { archivedAt: null, status: { [Op.ne]: "cancelled" } },
      required: true,
    };

    const events = [];

    // Tarjetas Kanban con fecha límite. Las de columnas "Hecho" se omiten:
    // trabajo terminado no necesita hueco en el calendario.
    const tasks = await Task.findAll({
      where: { dueDate: range },
      include: [
        projectInclude,
        ...(BoardColumn ? [{ model: BoardColumn, as: "boardColumn", attributes: ["name", "color", "isDoneColumn"], required: false }] : []),
      ],
      order: [["dueDate", "ASC"]],
      limit: 500,
    });
    for (const t of tasks) {
      if (t.boardColumn?.isDoneColumn) continue;
      const color = t.boardColumn?.color || TASK_FALLBACK;
      const projectLabel = t.project.code || t.project.name;
      events.push({
        id: `project-task:${t.id}`,
        title: `${t.title} · ${projectLabel}`,
        start: t.dueDate,
        allDay: true,
        backgroundColor: color,
        borderColor: color,
        extendedProps: {
          kind: "projectTask",
          taskId: t.id,
          projectId: t.projectId,
          projectName: t.project.name,
          projectCode: t.project.code ?? null,
          columnName: t.boardColumn?.name ?? null,
          priority: t.priority,
        },
      });
    }

    // Hitos del proyecto (dueDate obligatorio), coloreados por estado.
    if (Milestone) {
      const milestones = await Milestone.findAll({
        where: { dueDate: range },
        include: [projectInclude],
        order: [["dueDate", "ASC"]],
        limit: 200,
      });
      for (const m of milestones) {
        const color = MILESTONE_COLORS[m.status] || MILESTONE_COLORS.pending;
        const projectLabel = m.project.code || m.project.name;
        events.push({
          id: `project-milestone:${m.id}`,
          title: `🚩 ${m.name} · ${projectLabel}`,
          start: m.dueDate,
          allDay: true,
          backgroundColor: color,
          borderColor: color,
          extendedProps: {
            kind: "projectMilestone",
            milestoneId: m.id,
            projectId: m.projectId,
            projectName: m.project.name,
            projectCode: m.project.code ?? null,
            status: m.status,
          },
        });
      }
    }

    return events;
  } catch {
    return []; // proyectos no puede tumbar el calendario
  }
}
