import { DataTypes } from "sequelize";

/**
 * Patient — paciente del centro clínico (psicopedagogía infantil).
 *
 * Tabla independiente de `clients`. Aumenta usa `patients` para todo el flujo
 * clínico (sesiones, informes, coordinaciones). `clients` queda reservado al
 * uso comercial estándar del CRM.
 *
 * Sprint 1 (visual): solo estructura. Frontend con datos dummy hardcoded.
 */
export function definePatient(sequelize) {
  return sequelize.define(
    "Patient",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      firstName: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      lastName: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      birthDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      age: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 0, max: 120 },
      },
      educationCenter: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
      educationLevel: {
        type: DataTypes.STRING(80),
        allowNull: true,
      },
      referralReason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      referredBy: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      // Objetivos terapéuticos a nivel de paciente (tags cortos). Distinto de los
      // objetivos por sesión (ClinicSession.objectives).
      objectives: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      mainTherapistId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      enrollmentDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      attendanceFrequency: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("active", "paused", "discharged"),
        allowNull: false,
        defaultValue: "active",
      },
      dischargeDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      dischargeReason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "patients",
      indexes: [
        { fields: ["last_name", "first_name"], name: "patients_name_idx" },
        { fields: ["main_therapist_id"], name: "patients_therapist_idx" },
        { fields: ["status"], name: "patients_status_idx" },
      ],
    }
  );
}
