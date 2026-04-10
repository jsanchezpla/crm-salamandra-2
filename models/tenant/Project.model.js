import { DataTypes } from "sequelize";

export function defineProject(sequelize) {
  return sequelize.define(
    "Project",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      clientId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("active", "paused", "completed", "cancelled"),
        allowNull: false,
        defaultValue: "active",
      },
      columns: {
        type: DataTypes.JSONB,
        defaultValue: [
          { id: "todo", label: "Por hacer", order: 0 },
          { id: "in_progress", label: "En curso", order: 1 },
          { id: "done", label: "Hecho", order: 2 },
        ],
      },
      startDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      endDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      assignedTo: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      customFields: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
    },
    {
      tableName: "projects",
    }
  );
}
