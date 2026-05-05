/**
 * Único punto de mapeo BD → API para Project.
 *
 * Filtra `budgetAmount` y `budgetCurrency` cuando el solicitante no es
 * admin/superadmin ni lead del proyecto. Mismo patrón que
 * `serializeTeamMember` para `hourlyCost`.
 *
 * Uso:
 *   serializeProject(project, { isAdmin, isLead })
 *   serializeProject(project, { isAdmin, leadProjectIds: Set<string> })
 *
 * Para listados, precalcular `leadProjectIds` (set de project.id donde el
 * usuario actual es lead) en lugar de comprobar fila a fila.
 */
export function serializeProject(project, { isAdmin = false, isLead = null, leadProjectIds = null } = {}) {
  if (!project) return null;
  const p = typeof project.toJSON === "function" ? project.toJSON() : project;

  const canSeeBudget =
    isAdmin ||
    isLead === true ||
    (leadProjectIds instanceof Set && leadProjectIds.has(p.id));

  const result = {
    id: p.id,
    code: p.code ?? null,
    clientId: p.clientId ?? null,
    name: p.name,
    description: p.description ?? null,
    status: p.status,
    priority: p.priority,
    startDate: p.startDate ?? null,
    dueDate: p.dueDate ?? null,
    completedAt: p.completedAt ?? null,
    estimatedHours: p.estimatedHours != null ? Number(p.estimatedHours) : null,
    tags: p.tags ?? [],
    customFields: p.customFields ?? {},
    archivedAt: p.archivedAt ?? null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };

  if (canSeeBudget) {
    result.budgetAmount = p.budgetAmount != null ? Number(p.budgetAmount) : null;
    result.budgetCurrency = p.budgetCurrency ?? "EUR";
  }

  // Includes opcionales (los pasamos tal cual; el caller decide qué incluir)
  if (p.client) result.client = p.client;
  if (p.members) result.members = p.members;
  if (p.phases) result.phases = p.phases;
  if (p.milestones) result.milestones = p.milestones;
  if (p.boardColumns) result.boardColumns = p.boardColumns;
  if (p.taskCount != null) result.taskCount = p.taskCount;

  return result;
}
