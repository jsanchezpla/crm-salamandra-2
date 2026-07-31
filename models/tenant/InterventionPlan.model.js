import { DataTypes } from "sequelize";

/**
 * InterventionPlan — plan de intervención del paciente desde el inicio
 * (sprint Aumenta 2026-07-28). Uno por paciente (1:1).
 *
 * Recoge lo que antes vivía disperso o no existía: diagnóstico, motivos de
 * consulta, información previa, objetivos, tipos de actividades y metodologías.
 *
 * `reportSchedule` (JSONB) es la secuenciación de informes: cuántos informes de
 * objetivos y cuántos registros de sesión necesita el paciente POR TRIMESTRE
 * escolar — `{ objectivesReportsPerTrimester, sessionRecordsPerTrimester }`.
 * El cumplimiento no se guarda: se calcula en lectura contando informes y
 * sesiones dentro de cada trimestre (lib/clinica/trimestres.js).
 */
export function defineInterventionPlan(sequelize) {
  return sequelize.define(
    "InterventionPlan",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      patientId: {
        type: DataTypes.UUID,
        allowNull: false,
        unique: true,
      },
      diagnosis: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      consultationReasons: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      previousInfo: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Listas de strings (mismo patrón que Patient.objectives).
      objectives: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      activityTypes: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      methodologies: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      reportSchedule: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      createdById: {
        type: DataTypes.UUID,
        allowNull: true,
      },
    },
    {
      tableName: "intervention_plans",
      indexes: [{ fields: ["patient_id"], unique: true, name: "intervention_plans_patient_unique" }],
    }
  );
}
