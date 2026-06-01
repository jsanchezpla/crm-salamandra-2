import { DataTypes } from "sequelize";

/**
 * EventType — tipo de cita configurable por el tenant.
 *
 * Cada EventType describe un servicio que se puede reservar (p. ej. "Primera
 * consulta", "Seguimiento"). Incluye duración, buffers, modalidades aceptadas
 * (presencial / phone / online) y reglas de antelación.
 *
 * Sprint 1: gestión interna por admin del tenant.
 * Sprint 2: la landing pública lee `active` y `modalities`.
 */
export function defineEventType(sequelize) {
  return sequelize.define(
    "EventType",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      slug: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      duration: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 1, max: 480 },
      },
      bufferBefore: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        validate: { min: 0 },
      },
      bufferAfter: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        validate: { min: 0 },
      },
      color: {
        type: DataTypes.STRING(7),
        allowNull: true,
      },
      // Subset de ['presencial','phone','online'], mínimo 1
      modalities: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: ["online"],
      },
      // Datos por modalidad (snapshot al crear booking)
      location: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      phoneNumber: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      meetUrl: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // Etiqueta y obligatoriedad del campo libre para el cliente
      additionalDataLabel: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      additionalDataRequired: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // Reglas de antelación (para Sprint 2 — la landing las usa)
      minNoticeHours: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 3,
        validate: { min: 0 },
      },
      maxAdvanceDays: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 60,
        validate: { min: 1 },
      },
      active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      order: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: "event_types",
      indexes: [
        { unique: true, fields: ["slug"], name: "event_types_slug_unique" },
        { fields: ["active", "order"], name: "event_types_active_order_idx" },
      ],
    }
  );
}
