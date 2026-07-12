/**
 * Prioridad de tareas del módulo Proyectos.
 *
 * Mismo enum que `Project.priority` (low|medium|high|urgent) para coherencia.
 * Fuente única de: valores válidos, etiquetas ES, orden de mayor→menor y
 * estilos del badge. Lo consumen el modelo/endpoints (validación), el Kanban
 * (TaskCard/TaskDrawer) y la Vista de Lista (badge + ordenación).
 */

// Ordenadas de MAYOR a MENOR prioridad. El índice = rango para ordenar.
export const TASK_PRIORITIES = [
  { value: "urgent", label: "Urgente", badgeClass: "bg-rose-50 text-rose-700 border-rose-200" },
  { value: "high", label: "Alta", badgeClass: "bg-amber-50 text-amber-700 border-amber-200" },
  { value: "medium", label: "Media", badgeClass: "bg-sky-50 text-sky-700 border-sky-200" },
  { value: "low", label: "Baja", badgeClass: "bg-neutral-100 text-neutral-500 border-neutral-200" },
];

export const TASK_PRIORITY_VALUES = TASK_PRIORITIES.map((p) => p.value);

export const DEFAULT_TASK_PRIORITY = "medium";

// value → rango (0 = más prioritaria). Un valor desconocido/ausente va al final.
export const PRIORITY_RANK = TASK_PRIORITIES.reduce((acc, p, i) => {
  acc[p.value] = i;
  return acc;
}, {});

export function isValidTaskPriority(v) {
  return TASK_PRIORITY_VALUES.includes(v);
}

export function priorityRank(v) {
  const r = PRIORITY_RANK[v];
  return r === undefined ? TASK_PRIORITIES.length : r;
}

export function priorityMeta(v) {
  return TASK_PRIORITIES.find((p) => p.value === v) ?? { value: v, label: v ?? "—", badgeClass: "bg-neutral-100 text-neutral-500 border-neutral-200" };
}
