import { DataTypes } from "sequelize";

/**
 * PlanMeal — una "comida" dentro de un plan (Desayuno, Snack, Comida…).
 * Sprint nutri-laura Recetario C2.
 *
 * Nombre libre (sin enum) porque cada nutricionista organiza el día a
 * su manera. `order` define el orden visual dentro del plan.
 */
export function definePlanMeal(sequelize) {
  return sequelize.define(
    "PlanMeal",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      planId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: "plan_id",
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      order: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "order",
      },
    },
    {
      tableName: "plan_meals",
      indexes: [{ fields: ["plan_id"], name: "plan_meals_plan_id_idx" }],
    }
  );
}
