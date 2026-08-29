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
      patientId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      therapistId: {
        type: DataTypes.UUID,
        // Opcional desde el 02/08/2026. Para una sesión que se registra hoy lo
        // firma quien la da, pero al importar cuatro años de Aumenta salieron
        // 4.045 escritas por gente que ya no está en el centro. Tirar esas notas
        // clínicas, o atribuírselas a otra persona, son peores opciones que una
        // nota sin firma: sigue siendo el registro de lo que se hizo.
        allowNull: true,
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
      // ── Registro de sesión en 3 partes (sprint Aumenta 2026-07-28) ──────
      // 1) Preparación (OPCIONAL): notas previas + adjuntos (fotos/audio)
      //    que enriquecen el informe. prepFiles = [{ name, path, mimeType, size }].
      // 2) Informe (OBLIGATORIO): los campos de siempre (objectives,
      //    activities, performance, observations), por audio o por escrito.
      // 3) Feedback de los padres (OPCIONAL): recogido en la propia sesión.
      prepText: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      prepFiles: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      parentFeedback: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // ── Apartados del registro (29/08/2026, Aumenta por Rodrigo) ────────
      // El registro deja de tener campos fijos: se compone de apartados
      // (título + cuerpo) que salen de una PLANTILLA del centro, más los que se
      // añadan sueltos a esta sesión (lib/clinica/plantillas.js).
      //
      // Aquí van DOS cosas y solo dos: la foto de con qué apartados se escribió
      // (`apartados`, para que dentro de un año siga imprimiéndose con SUS
      // títulos aunque la plantilla haya cambiado) y el cuerpo de los apartados
      // NUEVOS. Los de siempre —objetivos, actividades, desempeño y las cuatro
      // observaciones— siguen en sus columnas de toda la vida: de ellas comen el
      // volcado a informes, las estadísticas y el anexo, y las 22.045 sesiones
      // de Aumenta no se tocan.
      contentSections: {
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
      // Metadatos del audio original (flujo de IA, fase posterior): duración en
      // segundos y marca de cuándo la IA terminó de procesar/estructurar.
      audioDurationSec: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 0 },
      },
      aiReviewedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // Estados: 'draft' (borrador) · 'ai_pending' (audio subido, esperando IA) ·
      // 'registered' (sesión guardada, estado normal) · 'published' (cerrada: la
      // pantalla lo rotula «Cerrada» desde el 29/08/2026 — cierra el registro para
      // el equipo, NO lo comparte con la familia).
      status: {
        type: DataTypes.ENUM("draft", "ai_pending", "registered", "published"),
        allowNull: false,
        defaultValue: "registered",
      },
      // Cliente/pagador (2026-07-23). Foto tomada del paciente al crear la
      // sesión, para llegar a la ficha del cliente sin depender del salto
      // paciente→cliente, que es frágil. El terapeuta ya se guarda aparte.
      clientId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: "client_id",
      },
    },
    {
      tableName: "clinic_sessions",
      indexes: [
        { fields: ["patient_id", "session_date"], name: "clinic_sessions_patient_date_idx" },
        { fields: ["therapist_id", "session_date"], name: "clinic_sessions_therapist_date_idx" },
      ],
    }
  );
}
