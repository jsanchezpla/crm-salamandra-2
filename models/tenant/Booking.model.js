import { DataTypes } from "sequelize";

/**
 * Booking — reserva de cita.
 *
 * Sprint 1: solo creación manual por el admin del tenant.
 * Sprint 2: la landing pública crea bookings con `cancellationToken` usable
 * para que el cliente cancele desde el email de confirmación.
 *
 * Notas:
 *   - `duration` y `meetUrl` se snapshotean al crear (no se recalculan si el
 *     EventType cambia después).
 *   - El campo `cancellationToken` se genera automáticamente; se usará en
 *     Sprint 2 al integrar emails.
 *   - Estados `cancelled` y `no_show` NO bloquean el slot horario; las
 *     validaciones de solapamiento se hacen a nivel de endpoint.
 */
export function defineBooking(sequelize) {
  return sequelize.define(
    "Booking",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      eventTypeId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      clientName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      clientEmail: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: { isEmail: true },
      },
      clientPhone: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      additionalData: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      scheduledAt: {
        type: DataTypes.DATE, // TIMESTAMP WITH TIME ZONE
        allowNull: false,
      },
      // Snapshot de la duración del EventType al crear el booking
      duration: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 1 },
      },
      modality: {
        type: DataTypes.ENUM("presencial", "phone", "online"),
        allowNull: false,
      },
      // Snapshot del meet URL si modality='online'
      meetUrl: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // 'pending' (Sprint Fase 1 nutri_laura) → bookings que esperan
      // confirmación manual del admin (lista de espera). Se ajusta el
      // default vía endpoint/tenant flag, no aquí: el modelo conserva
      // 'confirmed' como default para que la creación manual del admin
      // siga llegando ya confirmada.
      status: {
        type: DataTypes.ENUM("pending", "confirmed", "completed", "cancelled", "no_show"),
        allowNull: false,
        defaultValue: "confirmed",
      },
      // Uso futuro Sprint 2 (cancelación desde email)
      cancellationToken: {
        type: DataTypes.UUID,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      cancelledAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      cancellationReason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Miembro del equipo (profesional) asignado a la cita. Nullable/aditivo:
      // las citas existentes (incl. nutri_laura en prod) quedan sin asignar.
      // underscored global → columna team_member_id.
      teamMemberId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // Notas internas (no visibles al cliente)
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "bookings",
      indexes: [
        { fields: ["scheduled_at", "status"], name: "bookings_scheduled_status_idx" },
        { fields: ["client_email"], name: "bookings_client_email_idx" },
        { fields: ["team_member_id"], name: "bookings_team_member_idx" },
      ],
    }
  );
}
