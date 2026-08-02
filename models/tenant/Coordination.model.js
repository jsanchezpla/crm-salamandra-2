import { DataTypes } from "sequelize";

/**
 * Coordination — acta de una reunión de coordinación.
 *
 * Tipos: familia, colegio, psiquiatra, neuropediatra, otro terapeuta,
 * orientador, otro.
 *
 * Sprint 1: solo estructura. `aiTranscription` y `aiActaGenerated` vacíos.
 * Sprint posterior: dictado o subida de audio → transcripción + acta IA.
 */
export function defineCoordination(sequelize) {
  return sequelize.define(
    "Coordination",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      coordinationType: {
        type: DataTypes.ENUM(
          "family",
          "school",
          "psychiatrist",
          "neuropediatrician",
          "other_therapist",
          "orientator",
          "other"
        ),
        allowNull: false,
      },
      participants: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      coordinationDate: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      topics: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      agreements: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      nextActions: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      relatedPatientId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // ── Interna / externa (sprint Aumenta 2026-07-28) ───────────────────
      // internal = entre terapeutas del centro; external = con colegios,
      // hospitales, otros profesionales… Nullable: las filas antiguas quedan
      // sin clasificar. Con external, `externalEntity` dice con quién
      // ("Colegio San José", "Hospital Niño Jesús").
      scope: {
        type: DataTypes.ENUM("internal", "external"),
        allowNull: true,
      },
      externalEntity: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
      // Con QUIÉN se coordinó, apuntando a la agenda de contactos externos del
      // paciente (`external_contacts`) en vez de a un nombre reescrito a mano en
      // cada acta (Rodrigo, 02/08/2026).
      //
      // Nullable y sin sustituir a `participants`: las actas anteriores no
      // tienen a quién apuntar, y una reunión puede tener varios asistentes de
      // los que solo uno sea el contacto de referencia. `participants` sigue
      // siendo la lista de quién estuvo; esto es a quién pertenece la relación.
      externalContactId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      aiTranscription: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      aiActaGenerated: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      createdById: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      // Cliente/pagador (2026-07-23). Foto del paciente relacionado. El
      // created_by_id ya dice quién del equipo la registró.
      clientId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: "client_id",
      },
    },
    {
      tableName: "coordinations",
      indexes: [
        { fields: ["coordination_date"], name: "coordinations_date_idx" },
        { fields: ["related_patient_id"], name: "coordinations_patient_idx" },
        { fields: ["created_by_id"], name: "coordinations_creator_idx" },
      ],
    }
  );
}
