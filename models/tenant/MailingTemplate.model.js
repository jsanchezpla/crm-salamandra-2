import { DataTypes } from "sequelize";

/**
 * MailingTemplate — firmas y campañas guardadas como plantilla. Mismo formato
 * de bloques que una campaña (`lib/mailing/bloques.js`).
 *
 * `tipo`:
 *   firma    un solo bloque `firma` con los datos de una persona o del centro;
 *            el editor lo inserta al final del correo con un clic
 *   campana  un correo entero (asunto, preheader y bloques) del que partir
 */
export function defineMailingTemplate(sequelize) {
  return sequelize.define(
    "MailingTemplate",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      nombre: { type: DataTypes.STRING(120), allowNull: false },
      tipo: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "campana" },
      asunto: { type: DataTypes.STRING(200), allowNull: true },
      preheader: { type: DataTypes.STRING(200), allowNull: true },
      bloques: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      createdBy: { type: DataTypes.STRING(255), allowNull: true },
    },
    {
      tableName: "mailing_templates",
      indexes: [{ fields: ["tipo"], name: "mailing_templates_tipo_idx" }],
    }
  );
}
