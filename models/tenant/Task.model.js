import { DataTypes } from "sequelize";

export function defineTask(sequelize) {
  return sequelize.define(
    "Task",
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
      // FK a BoardColumn. Antes era STRING (legacy). Sprint 1 Proyectos
      // pasa el campo a UUID y enlaza con la tabla `board_columns`.
      boardColumnId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // Fase del proyecto a la que pertenece la tarea (opcional).
      phaseId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // Hito del proyecto al que se asocia la tarea (opcional).
      milestoneId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      order: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // FK a TeamMember (antes era UUID libre `assignedTo`).
      assigneeId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      estimatedHours: {
        type: DataTypes.DECIMAL(8, 2),
        allowNull: true,
        validate: { min: 0 },
      },
      dueDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      checklist: {
        type: DataTypes.JSONB,
        defaultValue: [],
      },
      tags: {
        type: DataTypes.JSONB,
        defaultValue: [],
      },
      customFields: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
    },
    {
      tableName: "tasks",
    }
  );
}
