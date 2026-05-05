import { DataTypes } from "sequelize";

/**
 * Plantilla de proyecto. Solo define la "receta" (fases, columnas Kanban,
 * hitos sugeridos relativos a startDate, etiquetas por defecto). Pertenece
 * al tenant, no a un usuario concreto.
 *
 * En Sprint 1 solo CRUD del modelo. La aplicación de plantilla a un proyecto
 * nuevo (con sustitución de fechas relativas) se implementa en Sprint 3.
 */
export function defineProjectTemplate(sequelize) {
  return sequelize.define(
    "ProjectTemplate",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Array de fases: [{ name, description?, order, durationDays?, color? }]
      phases: {
        type: DataTypes.JSONB,
        defaultValue: [],
      },
      // Array de columnas Kanban: [{ name, order, color?, isDoneColumn? }]
      boardColumns: {
        type: DataTypes.JSONB,
        defaultValue: [],
      },
      // Array de hitos sugeridos: [{ name, dueOffsetDays, phaseIndex? }]
      defaultMilestones: {
        type: DataTypes.JSONB,
        defaultValue: [],
      },
      defaultTags: {
        type: DataTypes.JSONB,
        defaultValue: [],
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      tableName: "project_templates",
    }
  );
}
