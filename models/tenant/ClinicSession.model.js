import { DataTypes } from "sequelize";

/**
 * ClinicSession — registro de una sesión clínica con un paciente.
 *
 * Sprint 1 (visual / maqueta): solo estructura. El frontend usa datos dummy
 * hardcoded; los campos `aiTranscription` y `aiStructured` quedan vacíos.
 *
 * Sprint posterior: dictado por voz → Whisper → transcription + OpenAI
 * estructurando en objectives/activities/performance/observations.
 */
export function defineClinicSession(sequelize) {
  return sequelize.define(
    "ClinicSession",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      clientId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      therapistId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      sessionDate: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      duration: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 1 },
      },
      objectives: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      activities: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      performance: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      observations: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      aiTranscription: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      aiStructured: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("draft", "published"),
        allowNull: false,
        defaultValue: "published",
      },
    },
    {
      tableName: "clinic_sessions",
      indexes: [
        { fields: ["client_id", "session_date"], name: "clinic_sessions_client_date_idx" },
        { fields: ["therapist_id", "session_date"], name: "clinic_sessions_therapist_date_idx" },
      ],
    }
  );
}
