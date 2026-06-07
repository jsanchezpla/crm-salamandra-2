import { DataTypes } from "sequelize";

/**
 * Columna del tablero Kanban de un proyecto. Cada proyecto tiene al menos
 * una columna (validación a nivel aplicación). Una sola por proyecto puede
 * tener `isDoneColumn=true` (columna de "Hecho" para reportes de progreso).
 *
 * Por defecto, al crear un Project se siembran 4 columnas:
 *   - "Por hacer", "En curso", "En revisión", "Hecho" (esta última con
 *     isDoneColumn=true).
 */
export function defineBoardColumn(sequelize) {
  return sequelize.define(
    "BoardColumn",
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
      order: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      // Hex color "#RRGGBB" para el header de la columna.
      color: {
        type: DataTypes.STRING(7),
        allowNull: true,
      },
      // Límite de tareas en la columna (Sprint futuro). Sin uso en Sprint 1.
      wipLimit: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 1 },
      },
      // Marca la columna que representa "completado" para cálculo de progreso.
      // Solo una por proyecto.
      isDoneColumn: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      tableName: "board_columns",
      indexes: [
        { fields: ["project_id", "order"], unique: true, name: "board_columns_project_order_unique" },
      ],
    }
  );
}
