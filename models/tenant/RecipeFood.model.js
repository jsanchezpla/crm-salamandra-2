import { DataTypes } from "sequelize";

/**
 * RecipeFood — un ingrediente (Food) dentro de una Recipe con su cantidad.
 * (Sprint 8.2, nutri_laura.)
 *
 * Réplica de la "línea de alimento" de plan_meal_option_foods, movida un nivel
 * abajo (ahora la línea cuelga de la receta, no de la opción). Se conservan
 * `householdLabel`/`householdGrams`/`notes` — además de (amount, unit, ordering)
 * de la spec — para: (1) poder calcular macros cuando unit='household'
 * (necesita los gramos de la medida casera), y (2) que un ingrediente de receta
 * sea tan capaz como una línea suelta del modelo antiguo. Reutiliza
 * `sanitizeFoodLine` y `computeFoodMacros` sin cambios.
 *
 * unit: reutiliza el enum existente enum_plan_meal_option_foods_unit (g|household|free).
 */
export function defineRecipeFood(sequelize) {
  return sequelize.define(
    "RecipeFood",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      recipeId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      foodId: {
        type: DataTypes.UUID,
        allowNull: false,
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
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      householdGrams: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
      },
      notes: {
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
      tableName: "recipe_foods",
      indexes: [
        { fields: ["recipe_id"], name: "recipe_foods_recipe_id_idx" },
        { fields: ["food_id"], name: "recipe_foods_food_id_idx" },
      ],
    }
  );
}
