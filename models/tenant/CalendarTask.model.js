import { DataTypes } from "sequelize";

export function defineCalendarTask(sequelize) {
  return sequelize.define(
    "CalendarTask",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      priority: {
        type: DataTypes.ENUM("high", "medium", "low"),
        allowNull: false,
        defaultValue: "medium",
      },
      status: {
        type: DataTypes.ENUM("pending", "done", "cancelled"),
        allowNull: false,
        defaultValue: "pending",
      },
      startDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      startTime: {
        type: DataTypes.TIME,
        allowNull: true,
      },
      endDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      endTime: {
        type: DataTypes.TIME,
        allowNull: true,
      },
      allDay: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      color: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      createdBy: {
        type: DataTypes.UUID,
        allowNull: true,
      },
    },
    {
      tableName: "calendar_tasks",
      underscored: true,
    }
  );
}
