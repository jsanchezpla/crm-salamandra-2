import { DataTypes } from "sequelize";

export function defineClient(sequelize) {
  return sequelize.define(
    "Client",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      type: {
        type: DataTypes.ENUM("individual", "company"),
        allowNull: false,
        defaultValue: "company",
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      taxId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      email: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: { isEmail: true },
      },
      phone: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      address: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
      status: {
        type: DataTypes.ENUM("active", "inactive", "prospect"),
        allowNull: false,
        defaultValue: "active",
      },
      portalAccess: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      portalEmail: {
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
      tableName: "clients",
    }
  );
}
