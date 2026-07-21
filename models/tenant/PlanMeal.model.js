import { DataTypes } from "sequelize";

/**
 * PlanMeal — una "comida" dentro de un plan (Desayuno, Snack, Comida…).
 * Sprint nutri-laura Recetario C2.
 *
 * Nombre libre (sin enum) porque cada nutricionista organiza el día a
 * su manera. `order` define el orden visual dentro del plan.
 *
 * `weekday` (rework 2026-07-22): día de la semana al que pertenece la comida,
 * 1=Lunes … 7=Domingo. NULLABLE: los planes anteriores al rework no tienen
 * días (su "semana" vivía como texto en plans.description) y siguen
 * funcionando como "menú sin días". Los planes nuevos nacen con la semana
 * completa (7 días × 5 comidas). Migración: migrate-nutricion-week-recipe-media.js.
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
      // 1=Lunes … 7=Domingo; NULL = comida sin día (planes pre-rework).
      weekday: {
        type: DataTypes.SMALLINT,
        allowNull: true,
        validate: { min: 1, max: 7 },
      },
    },
    {
      tableName: "plan_meals",
      indexes: [{ fields: ["plan_id"], name: "plan_meals_plan_id_idx" }],
    }
  );
}
