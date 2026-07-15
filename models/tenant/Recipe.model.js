import { DataTypes } from "sequelize";

/**
 * Recipe — receta reutilizable del recetario (Sprint 8.2, nutri_laura).
 *
 * Catálogo de recetas que agrupan ingredientes (`foods`). NO sustituye a
 * `foods` (que sigue siendo el catálogo de ingredientes con macros/100g):
 * una receta es una composición nombrada de ingredientes. D4 = SOLO
 * ingredientes (sin pasos, tiempo ni foto).
 *
 * Las macros de una receta se calculan agregando sus `recipe_foods`
 * (ver lib/nutricion/macros.js). Al asignar un menú a un paciente, la receta
 * se CONGELA (deep-copy) en plan_meal_option_recipes/…_recipe_foods (D1):
 * editar la receta original NO afecta a menús ya asignados.
 */
export function defineRecipe(sequelize) {
  return sequelize.define(
    "Recipe",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Usuario (master.users.id) que creó la receta. Sin FK física (vive en
      // otro schema), igual que el patrón de auditoría del CRM.
      createdBy: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      isArchived: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      tableName: "recipes",
      indexes: [
        { fields: ["is_archived"], name: "recipes_is_archived_idx" },
      ],
    }
  );
}
