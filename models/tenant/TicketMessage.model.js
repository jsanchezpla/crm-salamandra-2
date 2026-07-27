import { DataTypes } from "sequelize";

/**
 * Mensaje del hilo de un ticket de soporte.
 *
 * `isInternal` separa lo que ve el cliente de lo que no: una nota interna
 * ("ojo, ya llamó ayer enfadado") jamás sale por el portal ni por email.
 * `authorType` distingue quién escribió: "team" (alguien del CRM), "client"
 * (el cliente final desde el portal) o "system" (avisos automáticos: cambios
 * de estado, reaperturas).
 */
export function defineTicketMessage(sequelize) {
  return sequelize.define(
    "TicketMessage",
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
      authorType: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "team",
        validate: { isIn: [["team", "client", "system"]] },
      },
      // master.users.id si authorType === "team"; null en el resto.
      authorUserId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // Nombre para mostrar, foto en el momento (no se resincroniza).
      authorName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      body: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      isInternal: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // Resultado del email al cliente cuando la respuesta pública lo dispara:
      // "sent" | "failed" | "skipped" (sin email) | null (no aplicaba).
      emailStatus: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
    },
    {
      tableName: "ticket_messages",
    }
  );
}
