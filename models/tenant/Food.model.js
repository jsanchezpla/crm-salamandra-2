import { DataTypes } from "sequelize";

/**
 * Food — alimento del catálogo nutricional (Sprint nutri-laura C1).
 *
 * Catálogo de alimentos del tenant. Los registros se crean a mano por
 * la nutricionista (`source='custom'`) o importados desde OpenFoodFacts
 * (`source='openfoodfacts'` + `external_id` con el barcode/code de OFF).
 *
 * Macros opcionales (proteínas, carbs, grasas, fibra) por 100 g; no se
 * guarda kcal. `household_measures` permite que la nutricionista
 * configure equivalencias caseras (1 cucharada = 15 g, etc.).
 *
 * Soft-delete vía `archivedAt`. Solo se materializa la tabla `foods`
 * en `crm_nutri_laura` (la migración `add-nutricion-module-nutri-laura`
 * no la replica al resto de tenants).
 */
export function defineFood(sequelize) {
  return sequelize.define(
    "Food",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      slug: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      defaultUnit: {
        type: DataTypes.ENUM("g", "ml", "unidad"),
        allowNull: false,
        defaultValue: "g",
      },
      proteinPer100: {
        type: DataTypes.DECIMAL(8, 2),
        allowNull: true,
        field: "protein_per_100",
      },
      carbsPer100: {
        type: DataTypes.DECIMAL(8, 2),
        allowNull: true,
        field: "carbs_per_100",
      },
      fatPer100: {
        type: DataTypes.DECIMAL(8, 2),
        allowNull: true,
        field: "fat_per_100",
      },
      fiberPer100: {
        type: DataTypes.DECIMAL(8, 2),
        allowNull: true,
        field: "fiber_per_100",
      },
      // Array de { label: string, grams: number }. La UI inicializa con
      // la lista por defecto (cucharada, taza, vaso, etc.) cuando viene vacío.
      householdMeasures: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      source: {
        type: DataTypes.ENUM("openfoodfacts", "custom"),
        allowNull: false,
        defaultValue: "custom",
      },
      externalId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      barcode: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      tags: {
        type: DataTypes.ARRAY(DataTypes.TEXT),
        allowNull: false,
        defaultValue: [],
      },
      archivedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "foods",
      indexes: [
        { fields: ["name"], name: "foods_name_idx" },
        { fields: ["slug"], name: "foods_slug_idx" },
        { fields: ["external_id"], name: "foods_external_id_idx" },
        { fields: ["barcode"], name: "foods_barcode_idx" },
      ],
    }
  );
}
