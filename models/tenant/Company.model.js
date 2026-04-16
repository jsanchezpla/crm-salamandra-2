import { DataTypes } from "sequelize";

export function defineCompany(sequelize) {
  return sequelize.define(
    "Company",
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
      externalId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      settings: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
    },
    {
      tableName: "companies",
    }
  );
}
