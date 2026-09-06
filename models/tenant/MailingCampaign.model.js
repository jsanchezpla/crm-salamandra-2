import { DataTypes } from "sequelize";

/**
 * MailingCampaign — el correo: asunto, preheader, bloques y estado.
 *
 * Los bloques van en JSONB con el formato de `lib/mailing/bloques.js`. **El
 * HTML se genera al enviar, no se guarda** (plan 2.1): así un arreglo en el
 * render llega a «ver en el navegador» de los correos viejos, y no hay dos
 * copias de lo mismo que puedan discrepar.
 *
 * `estado` y quién lo cambia:
 *   borrador    se edita
 *   programada  tiene `programadaPara`; el temporizador la arranca a su hora
 *   enviando    hay filas pendientes en `mailing_sends`; avanza por lotes
 *               (lib/mailing/envio.js), desde el endpoint o el temporizador
 *   pausada     alguien la paró a mitad; se reanuda sin duplicar (UNIQUE)
 *   enviada     no queda nada pendiente
 *   cancelada   se canceló antes de salir (borrador/programada)
 *
 * `audiencia`: "todos" (todo el que ha dicho que sí) o "segmento" (`segmentId`).
 *
 * Los contadores (`totalDestinatarios`, `enviados`, `fallidos`, `suprimidos`)
 * son un RESUMEN que se recalcula desde `mailing_sends` al avanzar: la verdad
 * está en las filas.
 */
export function defineMailingCampaign(sequelize) {
  return sequelize.define(
    "MailingCampaign",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      nombre: { type: DataTypes.STRING(160), allowNull: false },
      asunto: { type: DataTypes.STRING(200), allowNull: true },
      preheader: { type: DataTypes.STRING(200), allowNull: true },
      bloques: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      audiencia: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "todos" },
      segmentId: { type: DataTypes.UUID, allowNull: true },
      replyTo: { type: DataTypes.STRING(255), allowNull: true },
      estado: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "borrador" },
      programadaPara: { type: DataTypes.DATE, allowNull: true },
      empezadaAt: { type: DataTypes.DATE, allowNull: true },
      terminadaAt: { type: DataTypes.DATE, allowNull: true },
      totalDestinatarios: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      enviados: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      fallidos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      suprimidos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      ultimoError: { type: DataTypes.TEXT, allowNull: true },
      createdBy: { type: DataTypes.STRING(255), allowNull: true },
    },
    {
      tableName: "mailing_campaigns",
      indexes: [
        { fields: ["estado"], name: "mailing_campaigns_estado_idx" },
        { fields: ["programada_para"], name: "mailing_campaigns_programada_idx" },
      ],
    }
  );
}
