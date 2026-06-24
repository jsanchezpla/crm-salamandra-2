import { DataTypes } from "sequelize";

/**
 * PlanMealOptionFood — alimento concreto dentro de una opción de comida.
 * Sprint nutri-laura Recetario C2.
 *
 * Modos de cantidad (`unit`):
 *
 *   unit='g'         → amount = gramos directos. household_label/grams NULL.
 *   unit='household' → cantidad expresada en una medida casera del
 *                      catálogo: household_label ("1 cucharada"),
 *                      household_grams (15.00) — se copia al insertar
 *                      para macros estables aunque el catálogo cambie
 *                      la medida después.
 *   unit='free'      → texto libre vía `notes`; amount NULL; macros no
 *                      computables (cuenta como null en el helper).
 *
 * Los 3 modos están reforzados por CHECK constraint en BD
 * (plan_meal_option_foods_unit_chk). La FK food_id → foods.id usa
 * ON DELETE RESTRICT para impedir borrar un alimento mientras esté en
 * uso en algún plan (template o asignado).
 */
export function definePlanMealOptionFood(sequelize) {
  return sequelize.define(
    "PlanMealOptionFood",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      optionId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: "option_id",
      },
      foodId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: "food_id",
      },
      amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
      },
      unit: {
        type: DataTypes.ENUM("g", "household", "free"),
        allowNull: false,
      },
      householdLabel: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "household_label",
      },
      householdGrams: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        field: "household_grams",
      },
      notes: {
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
      tableName: "plan_meal_option_foods",
      indexes: [
        { fields: ["option_id"], name: "plan_meal_option_foods_option_id_idx" },
        { fields: ["food_id"], name: "plan_meal_option_foods_food_id_idx" },
      ],
    }
  );
}
