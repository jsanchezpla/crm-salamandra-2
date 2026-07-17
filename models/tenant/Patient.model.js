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
      // Enlace opcional al Client de origen. Se rellena cuando el paciente se
      // materializa al marcar un Client como "Paciente Clínica" (sprint
      // Clientes↔módulos). Nullable: los pacientes creados directamente en el
      // módulo Clínica (flujo histórico de aumenta) no tienen Client asociado.
      clientId: {
        type: DataTypes.UUID,
        allowNull: true,
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
      // ── Datos personales (Aumenta) ──────────────────────────────────────
      dni: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      address: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      // Parentesco/relación con el cliente que paga (el tutor). Lista sugerida
      // en la UI (hijo/a · tutor legal · cónyuge · el propio cliente · hermano/a)
      // pero texto libre para "otro".
      relationship: {
        type: DataTypes.STRING(60),
        allowNull: true,
      },
      // Consentimientos RGPD con traza legal: por cada uno { granted: bool,
      // at: ISO, by: userId }. Claves: images | marketing | whatsapp.
      consents: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      // Contrato en papel firmado y escaneado. `contractSigned` = check rápido
      // (subido/no); `contractFile` = metadata del PDF (el binario vive en el
      // volumen de uploads vía attachmentStorage).
      contractSigned: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      contractFile: {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: null,
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
