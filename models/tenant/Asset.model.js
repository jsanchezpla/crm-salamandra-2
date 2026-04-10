import { DataTypes } from "sequelize";

export function defineAsset(sequelize) {
  return sequelize.define(
    "Asset",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      type: {
        type: DataTypes.ENUM("hardware", "software", "license", "material", "other"),
        allowNull: false,
        defaultValue: "hardware",
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      serialNumber: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("available", "assigned", "maintenance", "retired"),
        allowNull: false,
        defaultValue: "available",
      },
      assignedTo: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      clientId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      purchaseDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      expiresAt: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      value: {
        type: DataTypes.DECIMAL(12, 2),
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
      tableName: "assets",
    }
  );
}
