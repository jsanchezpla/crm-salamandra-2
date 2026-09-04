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
      // "Entrevista inicial" desde ese sprint (el valor en BD no cambia), y
      // desde el 03/09/2026 NO se crean más: la entrevista inicial es un
      // registro de sesión con su plantilla (lib/clinica/plantillas.js,
      // PLANTILLA_ENTREVISTA). Se queda en el enum por los que ya existen.
      // 'beca' (informe para la beca NEAE, 26/08/2026): sus apartados y los
      // nombres oficiales de la cabecera viven en lib/clinica/beca.js; el valor
      // lo añade al enum de cada schema scripts/migrate-informe-beca.js, que va
      // ANTES del despliegue.
      // 'asesoramiento' (04/09/2026, Aumenta por Rodrigo): el informe de las
      // sesiones de asesoramiento —las que ya factura el centro como tales—.
      // NO tiene apartados propios escritos aquí a propósito: se compone con
      // las plantillas del centro como el evolutivo, el de alta y el de
      // derivación (lib/clinica/plantillas.js); el único que se sale de esa
      // regla es la beca, porque sus apartados los manda la convocatoria. El
      // valor lo añade al enum de cada schema
      // scripts/migrate-informe-asesoramiento.js, que va ANTES del despliegue.
      reportType: {
        type: DataTypes.ENUM("evolution", "admission", "discharge", "referral", "beca", "asesoramiento"),
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
