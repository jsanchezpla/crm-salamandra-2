import { DataTypes } from "sequelize";

/**
 * PlanMealOptionRecipeFood — ingrediente CONGELADO de una receta dentro de un
 * plan (Sprint 8.2, nutri_laura). Es el snapshot de un RecipeFood en el momento
 * de añadir la receta a la opción / asignar el plan (D1 = congelado por deep-copy):
 * editar la receta original NO cambia estos valores.
 *
 * `foodId` mantiene la referencia al catálogo `foods` (las macros/100g se leen en
 * vivo del alimento, igual que hoy en plan_meal_option_foods — congelar la
 * ESTRUCTURA de la receta no congela las macros del ingrediente). `*_snapshot`
 * congela la cantidad/unidad/medida casera de la receta.
 */
export function definePlanMealOptionRecipeFood(sequelize) {
  return sequelize.define(
    "PlanMealOptionRecipeFood",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      planMealOptionRecipeId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      foodId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      amountSnapshot: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
      },
      unitSnapshot: {
        type: DataTypes.ENUM("g", "household", "free"),
        allowNull: false,
      },
      householdLabelSnapshot: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      householdGramsSnapshot: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
      },
      notesSnapshot: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      ordering: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: "plan_meal_option_recipe_foods",
      indexes: [
        { fields: ["plan_meal_option_recipe_id"], name: "pmorf_recipe_id_idx" },
        { fields: ["food_id"], name: "pmorf_food_id_idx" },
      ],
    }
  );
}
