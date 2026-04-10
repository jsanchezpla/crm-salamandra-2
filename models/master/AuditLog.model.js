import { DataTypes } from "sequelize";

export function defineAuditLog(sequelize) {
  return sequelize.define(
    "AuditLog",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      tenantId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      action: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      entity: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      entityId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      before: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      after: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      ip: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      tableName: "audit_logs",
      updatedAt: false,
    }
  );
}
