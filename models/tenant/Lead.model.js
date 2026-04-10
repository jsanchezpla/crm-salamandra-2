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
        type: DataTypes.ENUM("new", "contacted", "qualified", "proposal", "negotiation", "won", "lost"),
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
      // Campos de consulta web (Aumenta y similares)
      tipo_usuario: {
        type: DataTypes.ENUM("ciudadano", "profesional"),
        allowNull: true,
        defaultValue: "ciudadano",
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
    },
    {
      tableName: "leads",
    }
  );
}
