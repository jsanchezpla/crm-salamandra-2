import { DataTypes } from "sequelize";

/**
 * MailingEvent — cada clic y cada apertura, con su enlace y su hora.
 *
 * Los clics son la métrica principal del módulo; las aperturas se enseñan
 * como orientativas (Apple Mail y los filtros de spam «abren» los correos
 * sin que nadie los lea). Aquí queda el detalle para poder decir «el enlace
 * del taller tuvo 40 clics y el de la web 3»; los contadores resumidos viven
 * en `mailing_sends`.
 *
 * `tipo` ∈ clic | apertura. `indice` es la posición del enlace dentro del
 * correo (la que asigna el render), `url` el destino real.
 */
export function defineMailingEvent(sequelize) {
  return sequelize.define(
    "MailingEvent",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      sendId: { type: DataTypes.UUID, allowNull: false },
      campaignId: { type: DataTypes.UUID, allowNull: false },
      tipo: { type: DataTypes.STRING(20), allowNull: false },
      url: { type: DataTypes.TEXT, allowNull: true },
      indice: { type: DataTypes.INTEGER, allowNull: true },
      userAgent: { type: DataTypes.STRING(255), allowNull: true },
    },
    {
      tableName: "mailing_events",
      updatedAt: false,
      indexes: [
        { fields: ["campaign_id", "tipo"], name: "mailing_events_campaign_tipo_idx" },
        { fields: ["send_id"], name: "mailing_events_send_idx" },
      ],
    }
  );
}
