import { DataTypes } from "sequelize";

/**
 * MailingSegment — un grupo de destinatarios definido por REGLAS, no por una
 * lista de correos: «las familias de Nutrición con cita en los últimos seis
 * meses». Se resuelve en el momento del envío contra los datos del CRM
 * (`lib/mailing/audiencia.js`), así que no se queda viejo.
 *
 * Es el diferencial frente a Mailchimp (plan 3, entregable 3): allí la lista
 * es una foto; aquí la lista SABE quién es cliente de qué y cuándo vino por
 * última vez.
 *
 * `reglas` (JSONB), todas opcionales y en Y:
 *   {
 *     fuentes:    ["clientes", "contactos"],      // de dónde salen (por defecto las dos)
 *     modulos:    ["nutricion", "clinica"],       // ClientModuleAssignment
 *     estados:    ["active", "lead"],             // clients.status
 *     ultimaCita: { tipo: "hace_menos"|"hace_mas"|"nunca", dias: 180 }
 *   }
 * Lo que no se conoce se ignora (lib/mailing/audiencia.js normaliza).
 */
export function defineMailingSegment(sequelize) {
  return sequelize.define(
    "MailingSegment",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      nombre: { type: DataTypes.STRING(120), allowNull: false },
      descripcion: { type: DataTypes.TEXT, allowNull: true },
      reglas: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      createdBy: { type: DataTypes.STRING(255), allowNull: true },
    },
    {
      tableName: "mailing_segments",
      indexes: [{ fields: ["nombre"], name: "mailing_segments_nombre_idx" }],
    }
  );
}
