import { DataTypes } from "sequelize";

/**
 * Hito de un proyecto. Evento puntual con fecha (entrega, firma, pago…).
 * Puede pertenecer a una fase concreta o ser global del proyecto.
 */
export function defineMilestone(sequelize) {
  return sequelize.define(
    "Milestone",
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
      phaseId: {
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
      dueDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM("pending", "completed", "missed"),
        allowNull: false,
        defaultValue: "pending",
      },
      completedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "milestones",
      hooks: {
        beforeUpdate(milestone) {
          if (
            milestone.changed("status") &&
            milestone.status === "completed" &&
            !milestone.completedAt
          ) {
            milestone.completedAt = new Date();
          }
        },
      },
    }
  );
}
