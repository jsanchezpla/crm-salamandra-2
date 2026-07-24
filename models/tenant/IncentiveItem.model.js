import { DataTypes } from "sequelize";

/**
 * IncentiveItem — incentivo ESCRITO a mano por Dirección (módulo Clínica).
 *
 * Complementa a la propuesta automática por tramos: un concepto concreto
 * ("Cambiar la bombilla del centro", "Sustitución en agosto"…) asignado a una
 * terapeuta y a un periodo (mes), con valor en:
 *   - 'fixed'   → importe en € tal cual;
 *   - 'percent' → % sobre el SUELDO MENSUAL de la ficha de Equipo.
 *
 * `resolvedAmount` es la FOTO del importe en € calculada al crear/editar
 * (para 'percent', value × salaryBase/100). Se congela a propósito: si el
 * sueldo cambia después, los incentivos ya escritos no bailan; al editar el
 * item se recalcula con el sueldo vigente. `salaryBase` guarda la base usada
 * (transparencia).
 *
 * El total propuesto de un mes = propuesta por tramos + Σ resolvedAmount.
 */
export function defineIncentiveItem(sequelize) {
  return sequelize.define(
    "IncentiveItem",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      therapistId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      periodMonth: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 1, max: 12 },
      },
      periodYear: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 2020, max: 2100 },
      },
      concept: {
        type: DataTypes.STRING(200),
        allowNull: false,
      },
      valueType: {
        type: DataTypes.ENUM("fixed", "percent"),
        allowNull: false,
        defaultValue: "fixed",
      },
      // € si fixed; % (0-100) si percent.
      value: {
        type: DataTypes.DECIMAL(8, 2),
        allowNull: false,
        validate: { min: 0 },
      },
      // Importe final en € (foto al crear/editar).
      resolvedAmount: {
        type: DataTypes.DECIMAL(8, 2),
        allowNull: true,
        validate: { min: 0 },
      },
      // Sueldo mensual usado como base del % (foto; null si fixed).
      salaryBase: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
      },
      createdById: {
        type: DataTypes.UUID,
        allowNull: true,
      },
    },
    {
      tableName: "incentive_items",
      indexes: [
        { fields: ["therapist_id", "period_year", "period_month"], name: "incentive_items_therapist_period_idx" },
        { fields: ["period_year", "period_month"], name: "incentive_items_period_idx" },
      ],
    }
  );
}
