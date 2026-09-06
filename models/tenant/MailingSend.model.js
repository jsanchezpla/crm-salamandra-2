import { DataTypes } from "sequelize";

/**
 * MailingSend — una fila por destinatario y campaña. **Es el ancla de la
 * idempotencia** (plan 2.1): `UNIQUE (campaign_id, email)` hace que preparar
 * dos veces la misma campaña no duplique a nadie, y que reanudar un envío
 * cortado a mitad sea seguro: se recogen las filas `pendiente` y se sigue.
 *
 * `estado`:
 *   pendiente    en cola
 *   procesando   un lote la ha cogido (si el proceso muere, el temporizador
 *                la recupera pasados diez minutos)
 *   enviado      SES la aceptó (`sesMessageId`)
 *   fallido      SES la rechazó o se agotaron los reintentos (`error`)
 *   suprimido    estaba en la lista de supresión al ir a enviar: no salió
 *   rebotado     salió y AWS avisó de rebote duro (webhook)
 *   queja        salió y la persona la marcó como spam (webhook)
 *
 * `origen` dice de dónde salió el destinatario: "cliente" (ficha con la
 * casilla de novedades), "contacto" (`mailing_contacts`) o "prueba" (envío de
 * prueba al equipo: no cuenta en las métricas).
 *
 * Aperturas y clics son contadores resumidos; el detalle (qué enlace, cuándo)
 * está en `mailing_events`.
 */
export function defineMailingSend(sequelize) {
  return sequelize.define(
    "MailingSend",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      campaignId: { type: DataTypes.UUID, allowNull: false },
      email: { type: DataTypes.STRING(255), allowNull: false },
      nombre: { type: DataTypes.STRING(160), allowNull: true },
      origen: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "cliente" },
      origenId: { type: DataTypes.UUID, allowNull: true },
      estado: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "pendiente" },
      intentos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      sesMessageId: { type: DataTypes.STRING(120), allowNull: true },
      error: { type: DataTypes.TEXT, allowNull: true },
      enviadoAt: { type: DataTypes.DATE, allowNull: true },
      abiertoAt: { type: DataTypes.DATE, allowNull: true },
      primerClicAt: { type: DataTypes.DATE, allowNull: true },
      aperturas: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      clics: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    {
      tableName: "mailing_sends",
      indexes: [
        { unique: true, fields: ["campaign_id", "email"], name: "mailing_sends_campaign_email_uq" },
        { fields: ["campaign_id", "estado"], name: "mailing_sends_campaign_estado_idx" },
        { fields: ["ses_message_id"], name: "mailing_sends_ses_message_id_idx" },
      ],
    }
  );
}
