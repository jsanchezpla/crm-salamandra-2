import { DataTypes } from "sequelize";

/**
 * Recipe — receta reutilizable del recetario (Sprint 8.2, nutri_laura).
 *
 * Catálogo de recetas que agrupan ingredientes (`foods`). NO sustituye a
 * `foods` (que sigue siendo el catálogo de ingredientes con macros/100g):
 * una receta es una composición nombrada de ingredientes.
 *
 * Rework 2026-07-22 (revierte la parte "sin foto ni pasos" de D4, decisión de
 * producto de Rodrigo+Jorge): `photoPath` guarda la ruta RELATIVA de la foto en
 * disco (patrón documentStorage; el fichero vive bajo getUploadsRoot()) y
 * `steps` los pasos de preparación como JSONB [string]. Ambos se leen EN VIVO
 * también desde los menús asignados (via plan_meal_option_recipes.recipe_id):
 * el snapshot congela nombre e ingredientes, no la foto ni los pasos.
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
      // Ruta RELATIVA de la foto bajo getUploadsRoot() (p. ej.
      // "nutricion/{slug}/recipes/{recipeId}/{uuid}.jpg"). NULL = sin foto.
      photoPath: {
        type: DataTypes.STRING(500),
        allowNull: true,
        field: "photo_path",
      },
      // Pasos de preparación, en orden: JSONB ["Precalentar el horno…", …].
      steps: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
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
