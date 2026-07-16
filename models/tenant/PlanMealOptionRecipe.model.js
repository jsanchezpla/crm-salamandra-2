import { DataTypes } from "sequelize";

/**
 * PlanMealOptionRecipe — una receta dentro de una opción de comida de un plan
 * (Sprint 8.2, nutri_laura). Nuevo nivel de la jerarquía:
 *
 *   Plan → PlanMeal → PlanMealOption → PlanMealOptionRecipe → PlanMealOptionRecipeFood
 *
 * `recipeId` apunta a la Recipe origen (provenance; FK SET NULL — si se borra la
 * receta del catálogo, el snapshot sobrevive con `nameSnapshot`). `nameSnapshot`
 * congela el nombre de la receta en el momento de añadirla/asignarla (D1).
 * `servings` = cantidad en RACIONES (D3): 1, 2, 0.5…
 *
 * Convive con plan_meal_option_foods (líneas sueltas del modelo antiguo): una
 * opción puede tener recetas y/o alimentos sueltos durante la coexistencia (Z).
 */
export function definePlanMealOptionRecipe(sequelize) {
  return sequelize.define(
    "PlanMealOptionRecipe",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      planMealOptionId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      // Provenance de la receta origen. Nullable + SET NULL: el snapshot no
      // depende de que la receta siga existiendo.
      recipeId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      nameSnapshot: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      servings: {
        type: DataTypes.DECIMAL(6, 2),
        allowNull: false,
        defaultValue: 1,
        validate: { min: 0.01 },
      },
      ordering: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: "plan_meal_option_recipes",
      indexes: [
        { fields: ["plan_meal_option_id"], name: "pmor_option_id_idx" },
        { fields: ["recipe_id"], name: "pmor_recipe_id_idx" },
      ],
    }
  );
}
