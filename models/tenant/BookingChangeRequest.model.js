import { DataTypes } from "sequelize";

/**
 * BookingChangeRequest — propuesta de cambio de cita que una terapeuta
 * (no-admin) manda al centro. La cita NO se toca hasta que el admin la aprueba
 * ("no es definitivo"). Guarda snapshots (nombres, fecha actual) para que la
 * pestaña "Solicitudes" y la campanita se rendericen sin joins y sigan siendo
 * legibles aunque la cita cambie después.
 */
export function defineBookingChangeRequest(sequelize) {
  return sequelize.define(
    "BookingChangeRequest",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      bookingId: { type: DataTypes.UUID, allowNull: false },

      // Lo propuesto.
      proposedScheduledAt: { type: DataTypes.DATE, allowNull: false },
      proposedTeamMemberId: { type: DataTypes.UUID, allowNull: true },
      proposedTeamMemberName: { type: DataTypes.STRING, allowNull: true },
      reason: { type: DataTypes.TEXT, allowNull: true },

      // Snapshots para mostrar la solicitud (no se resincronizan).
      currentScheduledAt: { type: DataTypes.DATE, allowNull: true },
      subjectName: { type: DataTypes.STRING, allowNull: true },   // paciente o cliente
      eventTypeName: { type: DataTypes.STRING, allowNull: true },

      // Quién la propone.
      requestedByUserId: { type: DataTypes.UUID, allowNull: true },
      requestedByTeamMemberId: { type: DataTypes.UUID, allowNull: true },
      requestedByName: { type: DataTypes.STRING, allowNull: true },

      // Estado.
      status: {
        type: DataTypes.ENUM("pending", "approved", "rejected"),
        allowNull: false,
        defaultValue: "pending",
      },
      resolvedByUserId: { type: DataTypes.UUID, allowNull: true },
      resolvedAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "booking_change_requests",
      underscored: true,
      indexes: [
        { fields: ["status"], name: "booking_change_requests_status_idx" },
        { fields: ["booking_id"], name: "booking_change_requests_booking_id_idx" },
      ],
    }
  );
}
