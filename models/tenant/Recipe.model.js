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

      // ── Clasificación (04/08/2026, al traer las 1.083 recetas de Harbiz) ──
      //
      // Con mil recetas, un recetario sin filtros no se puede usar: encontrar
      // «un desayuno vegano sin lactosa de menos de 15 minutos» a ojo entre
      // 1.083 tarjetas no es buscar, es rendirse. Estos seis campos son lo que
      // Laura ya tenía en Harbiz y lo que hace navegable el catálogo.
      //
      // STRING y no ENUM a propósito: una nutricionista puede querer «cena» o
      // «postre» mañana, y ampliar un ENUM obliga a migrar. Los valores válidos
      // viven en lib/nutricion/recipes.js, que es donde se traducen a español.
      // Id en el sistema del que vino, si vino de alguno (Harbiz). Es lo que
      // hace idempotente la importación: el NOMBRE no identifica una receta
      // —Laura tiene 59 nombres repetidos que son recetas distintas— y usarlo
      // como clave dejó fuera 74 en la primera pasada.
      externalId: {
        type: DataTypes.STRING(120),
        allowNull: true,
        field: "external_id",
      },
      recipeType: {
        type: DataTypes.STRING(40),
        allowNull: true,
        field: "recipe_type",
      },
      // Libres, de la nutricionista: «rápido», «batch cooking», «sin horno».
      tags: {
        type: DataTypes.ARRAY(DataTypes.TEXT),
        allowNull: false,
        defaultValue: [],
      },
      // Los 14 alérgenos de declaración obligatoria (Reglamento UE 1169/2011).
      // Aquí NO es decoración: sirve para no mandarle a una celíaca un menú con
      // gluten, así que se guarda aparte de las etiquetas libres.
      allergens: {
        type: DataTypes.ARRAY(DataTypes.TEXT),
        allowNull: false,
        defaultValue: [],
      },
      // «vegetarian», «vegan»…
      dietaryPreferences: {
        type: DataTypes.ARRAY(DataTypes.TEXT),
        allowNull: false,
        defaultValue: [],
        field: "dietary_preferences",
      },
      // Minutos de preparación. En Harbiz venía como "MM:SS" y a veces ":50".
      durationMinutes: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "duration_minutes",
      },
      // Para cuántas personas son las cantidades de los ingredientes.
      rations: {
        type: DataTypes.INTEGER,
        allowNull: true,
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
