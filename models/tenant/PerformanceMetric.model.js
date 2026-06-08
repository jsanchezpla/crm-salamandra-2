import { DataTypes } from "sequelize";

/**
 * PerformanceMetric — puntuación mensual de un terapeuta.
 *
 * 7 áreas (la nº 5 del documento de Aumenta se omite intencionadamente porque
 * el cliente saltó la numeración) + 3 complementos (ocupación, antigüedad,
 * asistencia).
 *
 * Sprint 1: solo estructura. El frontend usa datos dummy hardcoded para el
 * dashboard de "Mi desempeño" y el panel de Dirección.
 * Sprint posterior: cálculo real a partir de ClinicSession, ClinicalReport,
 * BookingsRRHH y Coordination.
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
