import { DataTypes } from "sequelize";

/**
 * WaitlistEntry — lista de espera de CLIENTES del centro (sprint Aumenta
 * 2026-07-28). No confundir con la "lista de espera" de citas (bookings en
 * estado pending, que son solicitudes de reserva concretas): esto es gente
 * esperando PLAZA, sin cita ni fecha.
 *
 * Orden de llegada: los nuevos entran automáticamente al final (`position` =
 * max + 1). `specialty` opcional (claves de lib/clinica/specialties.js) por si
 * el centro quiere filtrar por servicio.
 */
export function defineWaitlistEntry(sequelize) {
  return sequelize.define(
    "WaitlistEntry",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(200),
        allowNull: false,
      },
      phone: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      specialty: {
        type: DataTypes.STRING(40),
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("active", "converted", "removed"),
        allowNull: false,
        defaultValue: "active",
      },
      position: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      // Ficha creada al convertir la entrada en cliente (FK lógica, SET NULL
      // en la migración).
      clientId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // Profesional al que se le asigna la familia mientras espera plaza
      // (Rodrigo, 01/08/2026). Nullable a propósito: la cola es «esperando
      // asignación», así que entrar sin terapeuta es un estado LEGÍTIMO, no un
      // dato incompleto. Lo que no vale es que no se pueda asignar nunca.
      //
      // FK lógica a `team_members`, con SET NULL en la migración: si el
      // profesional se da de baja, la familia sigue en la cola —vuelve a estar
      // pendiente de asignación— en vez de desaparecer con él.
      assignedTherapistId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
    },
    {
      tableName: "waitlist_entries",
      indexes: [
        { fields: ["status", "position"], name: "waitlist_entries_status_position_idx" },
        { fields: ["assigned_therapist_id"], name: "waitlist_entries_therapist_idx" },
      ],
    }
  );
}
