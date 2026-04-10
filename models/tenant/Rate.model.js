import { DataTypes } from "sequelize";

export function defineRate(sequelize) {
  return sequelize.define(
    "Rate",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      therapistId: {
        type: DataTypes.UUID,
        allowNull: true, // null = tarifa general del centro
      },
      serviceType: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      pricePerSession: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
      },
      packConfig: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
      validFrom: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      validTo: {
        type: DataTypes.DATEONLY,
        allowNull: true, // null = vigente indefinidamente
      },
    },
    {
      tableName: "rates",
    }
  );
}
