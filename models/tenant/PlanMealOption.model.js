import { DataTypes } from "sequelize";

/**
 * PlanMealOption — opción intercambiable dentro de una comida.
 * Sprint nutri-laura Recetario C2.
 *
 * Cada PlanMeal tiene N opciones (al menos 1). La opción `is_default=true`
 * es la que se muestra primero al paciente; las demás se ofrecen como
 * alternativas equivalentes nutricionalmente.
 *
 * Solo UNA opción por comida puede tener is_default=true a la vez
 * (la regla se enforce en el endpoint PATCH dentro de una transacción
 * que pone is_default=false en las demás).
 */
export function definePlanMealOption(sequelize) {
  return sequelize.define(
    "PlanMealOption",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      mealId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: "meal_id",
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "Opción 1",
      },
      order: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "order",
      },
      isDefault: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: "is_default",
      },
    },
    {
      tableName: "plan_meal_options",
      indexes: [{ fields: ["meal_id"], name: "plan_meal_options_meal_id_idx" }],
    }
  );
}
