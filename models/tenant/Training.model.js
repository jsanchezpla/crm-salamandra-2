import { DataTypes } from "sequelize";

export function defineTraining(sequelize) {
  return sequelize.define(
    "Training",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      type: {
        type: DataTypes.ENUM("course", "certification", "workshop", "other"),
        allowNull: false,
        defaultValue: "course",
      },
      status: {
        type: DataTypes.ENUM("pending", "in_progress", "completed", "expired"),
        allowNull: false,
        defaultValue: "pending",
      },
      provider: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      startDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      completedAt: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      expiresAt: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      certificateUrl: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      customFields: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
    },
    {
      tableName: "trainings",
    }
  );
}
