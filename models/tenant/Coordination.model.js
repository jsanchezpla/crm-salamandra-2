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
      relatedClientId: {
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
    },
    {
      tableName: "coordinations",
      indexes: [
        { fields: ["coordination_date"], name: "coordinations_date_idx" },
        { fields: ["related_client_id"], name: "coordinations_client_idx" },
        { fields: ["created_by_id"], name: "coordinations_creator_idx" },
      ],
    }
  );
}
