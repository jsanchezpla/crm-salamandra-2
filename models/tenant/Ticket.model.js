import { DataTypes } from "sequelize";

export function defineTicket(sequelize) {
  return sequelize.define(
    "Ticket",
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
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("open", "in_progress", "waiting", "resolved", "closed"),
        allowNull: false,
        defaultValue: "open",
      },
      priority: {
        type: DataTypes.ENUM("low", "medium", "high", "critical"),
        allowNull: false,
        defaultValue: "medium",
      },
      assignedTo: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      messages: {
        type: DataTypes.JSONB,
        defaultValue: [],
      },
      resolvedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      customFields: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
    },
    {
      tableName: "tickets",
    }
  );
}
