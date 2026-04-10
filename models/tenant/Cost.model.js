import { DataTypes } from "sequelize";

export function defineCost(sequelize) {
  return sequelize.define(
    "Cost",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      // Mes al que pertenece el coste — formato YYYY-MM para agrupar fácilmente
      month: {
        type: DataTypes.STRING(7),
        allowNull: false,
        validate: { is: /^\d{4}-(0[1-9]|1[0-2])$/ },
      },
      type: {
        type: DataTypes.ENUM("salary", "rent", "software", "material", "commission", "other"),
        allowNull: false,
      },
      category: {
        type: DataTypes.ENUM("fixed", "variable", "capex"),
        allowNull: false,
      },
      description: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
      },
      // Para costes salariales asociados a un terapeuta específico
      therapistId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
    },
    {
      tableName: "costs",
    }
  );
}
