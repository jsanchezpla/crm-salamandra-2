/**
 * Crea las 4 columnas por defecto del Kanban para un proyecto recién creado.
 * La última columna ("Hecho") se marca con `isDoneColumn = true` para
 * cálculo de progreso en reportes.
 */
export async function createDefaultBoardColumns({ projectId, tenantModels, transaction = null }) {
  const { BoardColumn } = tenantModels;
  const defaults = [
    { name: "Por hacer",   order: 0, color: "#94A3B8", isDoneColumn: false },
    { name: "En curso",    order: 1, color: "#3B82F6", isDoneColumn: false },
    { name: "En revisión", order: 2, color: "#F59E0B", isDoneColumn: false },
    { name: "Hecho",       order: 3, color: "#10B981", isDoneColumn: true  },
  ];

  const rows = await Promise.all(
    defaults.map((col) =>
      BoardColumn.create({ projectId, ...col }, { transaction })
    )
  );
  return rows;
}
