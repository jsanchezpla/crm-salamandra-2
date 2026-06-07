import { DataTypes } from "sequelize";

/**
 * Fase de un proyecto. Bloque temporal/conceptual ("Análisis", "Desarrollo",
 * "Entrega"). Una fase puede agrupar tareas y hitos. Borrado en cascada con
 * el proyecto.
 */
export function definePhase(sequelize) {
  return sequelize.define(
    "Phase",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      projectId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Orden contiguo dentro del proyecto. UNIQUE (projectId, order).
      order: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      startDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      endDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      // Hex color para la UI, ej. "#3B82F6". 7 chars (#RRGGBB).
      color: {
        type: DataTypes.STRING(7),
        allowNull: true,
      },
      completedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "phases",
      indexes: [
        { fields: ["project_id", "order"], unique: true, name: "phases_project_order_unique" },
      ],
    }
  );
}
