import { DataTypes } from "sequelize";

export function defineLead(sequelize) {
  return sequelize.define(
    "Lead",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      clientId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // Campos de identidad (contacto directo)
      name: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      phone: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      email: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: { isEmail: true },
      },
      title: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      stage: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "new",
      },
      probability: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 0, max: 100 },
      },
      value: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
      },
      expectedCloseDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      assignedTo: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Legado de la web antigua de Aumenta (ciudadano/profesional). La
      // distinción vive hoy en los MÓDULOS (leads = profesionales,
      // formularios = comerciales), así que ya no se escribe ni se enseña
      // (25/08/2026, Rodrigo); la columna queda por los datos históricos.
      tipo_usuario: {
        type: DataTypes.ENUM("ciudadano", "profesional"),
        allowNull: true,
      },
      motivo: {
        type: DataTypes.ENUM("diagnostico", "servicios", "cursos", "talleres"),
        allowNull: true,
      },
      servicio: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      curso: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      taller: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      mensaje: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      customFields: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
      source: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      metadata: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
      // FK a Project. Si un lead se convierte en proyecto, queda apuntado
      // aquí para que el frontend pueda mostrar "Ver proyecto vinculado"
      // en lugar del botón de conversión.
      convertedProjectId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      convertedToProjectAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "leads",
    }
  );
}
