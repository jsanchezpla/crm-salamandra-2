import { DataTypes } from "sequelize";

export function defineTenant(sequelize) {
  return sequelize.define(
    "Tenant",
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
      slug: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
          is: /^[a-z0-9_]+$/,
        },
      },
      dbName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      plan: {
        type: DataTypes.ENUM("free", "starter", "pro", "enterprise"),
        allowNull: false,
        defaultValue: "starter",
      },
      status: {
        type: DataTypes.ENUM("active", "inactive", "suspended"),
        allowNull: false,
        defaultValue: "active",
      },
      settings: {
        type: DataTypes.JSONB,
        defaultValue: {
          brand: {
            primaryColor: "#4F46E5",
            secondaryColor: "#0F0F0F",
            logoUrl: null,
          },
        },
      },
    },
    {
      tableName: "tenants",
    }
  );
}
