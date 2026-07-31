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
      patientId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      therapistId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      // 'referral' (Derivación) añadido en el sprint Aumenta 2026-07-28; la
      // especialidad destino va en contentSections.referralSpecialty
      // (claves de lib/clinica/derivaciones.js). 'admission' se ETIQUETA
      // "Entrevista inicial" desde ese sprint (el valor en BD no cambia).
      reportType: {
        type: DataTypes.ENUM("evolution", "admission", "discharge", "referral"),
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
      // "Enviar al paciente" (sprint Aumenta 2026-07-28): al entregar, el
      // informe se exporta a PDF y se crea un Document visible en el área
      // privada de la familia. Esta es la FK lógica a ese Document.
      deliveredDocumentId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // Cliente/pagador (2026-07-23). Foto del paciente al crear el informe.
      clientId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: "client_id",
      },
    },
    {
      tableName: "clinical_reports",
      indexes: [
        { fields: ["patient_id", "report_date"], name: "clinical_reports_patient_date_idx" },
        { fields: ["therapist_id", "report_date"], name: "clinical_reports_therapist_date_idx" },
        { fields: ["status", "due_date"], name: "clinical_reports_status_due_idx" },
      ],
    }
  );
}
