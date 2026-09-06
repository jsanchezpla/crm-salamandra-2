import { DataTypes } from "sequelize";

/**
 * MailingSuppression — de aquí no sale nadie nunca más.
 *
 * Bajas (la persona pinchó «darme de baja»), rebotes duros (la dirección no
 * existe) y quejas (la marcó como spam). **Se consulta en TODO envío, venga
 * de donde venga** (`lib/mailing/audiencia.js`): una dirección suprimida no
 * recibe campañas aunque la ficha del cliente siga con la casilla de
 * novedades marcada, aunque se importe otra vez en un CSV, aunque se añada a
 * mano. Es ley (LSSI/RGPD) y es la regla de AWS: por encima del 0,1 % de
 * quejas te ponen en revisión y en el 0,5 % te paran el envío.
 *
 * No hay endpoint que borre filas. `motivo` ∈ baja | rebote | queja | manual.
 * `campaignId` es referencia blanda (sin FK): la campaña puede borrarse y la
 * supresión tiene que sobrevivirla.
 */
export function defineMailingSuppression(sequelize) {
  return sequelize.define(
    "MailingSuppression",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      email: { type: DataTypes.STRING(255), allowNull: false },
      motivo: { type: DataTypes.STRING(20), allowNull: false },
      detalle: { type: DataTypes.TEXT, allowNull: true },
      campaignId: { type: DataTypes.UUID, allowNull: true },
    },
    {
      tableName: "mailing_suppressions",
      updatedAt: false,
      indexes: [{ unique: true, fields: ["email"], name: "mailing_suppressions_email_uq" }],
    }
  );
}
