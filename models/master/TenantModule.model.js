import { DataTypes } from "sequelize";

export function defineTenantModule(sequelize) {
  return sequelize.define(
    "TenantModule",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      tenantId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      moduleKey: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      version: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      schemaExtensions: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
      logicOverrides: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
      uiOverride: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      featureFlags: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
    },
    {
      tableName: "tenant_modules",
      indexes: [
        {
          unique: true,
          fields: ["tenant_id", "module_key"],
        },
      ],
    }
  );
}
