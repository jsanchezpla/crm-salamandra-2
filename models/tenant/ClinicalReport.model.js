import { DataTypes } from "sequelize";

/**
 * ClinicalReport — informe clínico generado para un paciente.
 *
 * Tipos: evolution (informe evolutivo), admission (de admisión), discharge
 * (de alta).
 *
 * Sprint 1: solo estructura. `aiGenerated` y `contentSections` vacíos; el
 * frontend muestra datos dummy hardcoded.
 * Sprint posterior: a partir de N ClinicSession del paciente, OpenAI redacta
 * el informe completo (estructurado en `contentSections`).
 */
export function defineClinicalReport(sequelize) {
  return sequelize.define(
    "ClinicalReport",
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
      reportType: {
        type: DataTypes.ENUM("evolution", "admission", "discharge"),
        allowNull: false,
        defaultValue: "evolution",
      },
      reportDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      deliveredAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      dueDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      aiGenerated: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      contentSections: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      attachments: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      status: {
        type: DataTypes.ENUM("draft", "reviewed", "delivered"),
        allowNull: false,
        defaultValue: "draft",
      },
    },
    {
      tableName: "clinical_reports",
      indexes: [
        { fields: ["client_id", "report_date"], name: "clinical_reports_client_date_idx" },
        { fields: ["therapist_id", "report_date"], name: "clinical_reports_therapist_date_idx" },
        { fields: ["status", "due_date"], name: "clinical_reports_status_due_idx" },
      ],
    }
  );
}
