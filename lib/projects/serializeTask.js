/**
 * Único punto de mapeo BD → API para Task del módulo Proyectos (Sprint 2).
 *
 * Si la task viene con include `assignees` (N-a-N TeamMember vía
 * TaskAssignee), normaliza el shape para que el frontend reciba
 * `[{ id, teamMemberId, displayName, email, avatarUrl, avatarColor }]`.
 *
 * Si la task viene con `boardColumn`, `project`, `phase`, `milestone`,
 * `assigneeLinks`, los reexporta tal cual.
 */
export function serializeTask(task) {
  if (!task) return null;
  const t = typeof task.toJSON === "function" ? task.toJSON() : task;

  const assignees = Array.isArray(t.assignees)
    ? t.assignees.map((m) => ({
        // Compatibilidad: si vino de `assignees` (TeamMember con TaskAssignee
        // anidado por el alias `through`), Sequelize coloca el join row en
        // `TaskAssignee` por defecto. Soportamos ambos casos.
        teamMemberId: m.id ?? m.teamMemberId,
        displayName: m.displayName ?? null,
        email: m.email ?? null,
        avatarUrl: m.avatarUrl ?? null,
        avatarColor: m.avatarColor ?? null,
      }))
    : [];

  return {
    id: t.id,
    projectId: t.projectId,
    boardColumnId: t.boardColumnId ?? null,
    phaseId: t.phaseId ?? null,
    milestoneId: t.milestoneId ?? null,
    order: t.order ?? 0,
    title: t.title,
    description: t.description ?? null,
    priority: t.priority ?? "medium",
    estimatedHours: t.estimatedHours != null ? Number(t.estimatedHours) : null,
    dueDate: t.dueDate ?? null,
    checklist: Array.isArray(t.checklist) ? t.checklist : [],
    tags: Array.isArray(t.tags) ? t.tags : [],
    customFields: t.customFields ?? {},
    // Legacy 1-a-1 (mantenido por compatibilidad — backlog Sprint 3).
    assigneeId: t.assigneeId ?? null,
    assignees,
    boardColumn: t.boardColumn ?? undefined,
    project: t.project ?? undefined,
    phase: t.phase ?? undefined,
    milestone: t.milestone ?? undefined,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}
