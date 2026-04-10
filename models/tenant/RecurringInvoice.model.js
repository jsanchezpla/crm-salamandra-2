import { DataTypes } from "sequelize";

export function defineRecurringInvoice(sequelize) {
  return sequelize.define(
    "RecurringInvoice",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      clientId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      familyId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      frequency: {
        type: DataTypes.ENUM("weekly", "biweekly", "monthly"),
        allowNull: false,
      },
      nextRunAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      templateConfig: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
      active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      tableName: "recurring_invoices",
    }
  );
}
