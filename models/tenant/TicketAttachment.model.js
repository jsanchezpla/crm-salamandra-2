import { DataTypes } from "sequelize";

/**
 * Adjunto de un ticket (captura, PDF...). El binario vive en disco
 * (lib/support/ticketStorage.js); aquí solo los metadatos.
 *
 * `messageId` enlaza el adjunto al mensaje concreto del hilo con el que llegó;
 * null = adjunto de la descripción inicial del ticket. La visibilidad en el
 * portal la decide el mensaje: adjunto de nota interna no se sirve nunca fuera.
 */
export function defineTicketAttachment(sequelize) {
  return sequelize.define(
    "TicketAttachment",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      ticketId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      messageId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      fileName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      storagePath: {
        type: DataTypes.STRING(500),
        allowNull: false,
      },
      fileSize: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      mimeType: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      uploadedByType: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "team",
        validate: { isIn: [["team", "client"]] },
      },
    },
    {
      tableName: "ticket_attachments",
    }
  );
}
