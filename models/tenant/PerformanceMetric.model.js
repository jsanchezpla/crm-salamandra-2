import { DataTypes } from "sequelize";

/**
 * PerformanceMetric — puntuación mensual de un terapeuta.
 *
 * 7 áreas (la nº 5 del documento de Aumenta se omite intencionadamente porque
 * el cliente saltó la numeración) + 3 complementos (ocupación, antigüedad,
 * asistencia).
 *
 * Puntuación e incentivo (REALES desde 2026-07-24, ver lib/clinica/incentives.js):
 *   - las puntuaciones por área (area1..area8) y los complementos los INTRODUCE
 *     Dirección en el editor de evaluación (POST /api/clinica/performance);
 *   - `totalScore` se calcula como media PONDERADA de las áreas puntuadas
 *     (pesos de performanceAreas.js) al guardar;
 *   - `proposedIncentive` se deriva de `totalScore` según la TABLA DE TRAMOS del
 *     tenant (tenant.settings.clinica.incentiveTiers); se recalcula en vivo;
 *   - `approvedIncentive` es el importe que Dirección aprueba/ajusta a mano.
 *
 * Sprint posterior (Productividad): auto-derivar el complemento de ocupación (%
 * horas de intervención directa) a partir de Booking/ClinicSession, en vez de
 * introducirlo a mano.
 */
export function definePerformanceMetric(sequelize) {
  return sequelize.define(
    "PerformanceMetric",
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
      // Desempeño por roles (2026-07-29): rol de desempeño con el que se evaluó
      // la fila y puntuaciones por clave de área en JSONB (fuente de verdad
      // nueva). Las columnas areaNScore legacy SE QUEDAN: se espejan al
      // escribir claves area1..area8 y son el fallback de lectura de las filas
      // históricas de aumenta (migración migrate-clinica-performance-roles.js).
      roleKey: { type: DataTypes.STRING(64), allowNull: true, field: "role_key" },
      areaScores: { type: DataTypes.JSONB, allowNull: true, defaultValue: {}, field: "area_scores" },
      area1Score: { type: DataTypes.INTEGER, allowNull: true, validate: { min: 0, max: 100 } },
      area2Score: { type: DataTypes.INTEGER, allowNull: true, validate: { min: 0, max: 100 } },
      area3Score: { type: DataTypes.INTEGER, allowNull: true, validate: { min: 0, max: 100 } },
      area4Score: { type: DataTypes.INTEGER, allowNull: true, validate: { min: 0, max: 100 } },
      area6Score: { type: DataTypes.INTEGER, allowNull: true, validate: { min: 0, max: 100 } },
      area7Score: { type: DataTypes.INTEGER, allowNull: true, validate: { min: 0, max: 100 } },
      area8Score: { type: DataTypes.INTEGER, allowNull: true, validate: { min: 0, max: 100 } },
      complementOccupation: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 0, max: 100 },
      },
      complementSeniority: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 0 },
      },
      complementAttendance: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
      },
      totalScore: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 0, max: 100 },
      },
      proposedIncentive: {
        type: DataTypes.DECIMAL(8, 2),
        allowNull: true,
        validate: { min: 0 },
      },
      approvedIncentive: {
        type: DataTypes.DECIMAL(8, 2),
        allowNull: true,
        validate: { min: 0 },
      },
      approvedById: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      approvedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "performance_metrics",
      indexes: [
        {
          fields: ["therapist_id", "period_year", "period_month"],
          name: "performance_metrics_therapist_period_unique",
          unique: true,
        },
        { fields: ["period_year", "period_month"], name: "performance_metrics_period_idx" },
      ],
    }
  );
}
