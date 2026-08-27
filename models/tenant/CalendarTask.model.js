import { DataTypes } from "sequelize";

export function defineCalendarTask(sequelize) {
  return sequelize.define(
    "CalendarTask",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      priority: {
        type: DataTypes.ENUM("high", "medium", "low"),
        allowNull: false,
        defaultValue: "medium",
      },
      status: {
        type: DataTypes.ENUM("pending", "done", "cancelled"),
        allowNull: false,
        defaultValue: "pending",
      },
      startDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      startTime: {
        type: DataTypes.TIME,
        allowNull: true,
      },
      endDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      endTime: {
        type: DataTypes.TIME,
        allowNull: true,
      },
      allDay: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      color: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      createdBy: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // FKs opcionales (nullable, aditivas): asociar la tarea a un cliente y/o
      // a un miembro del equipo. underscored → columnas client_id / team_member_id.
      clientId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      teamMemberId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      /*
       * La videollamada del evento (27/08/2026). El Calendario es de reuniones
       * ENTRE PROFESIONALES, no de citas con un paciente, y hasta hoy el enlace
       * de la sala viajaba por WhatsApp y no quedaba en ningún sitio.
       *
       * `meetUrl` lo PEGA quien crea el evento: el CRM no genera salas, mismo
       * criterio que `lib/citas/videollamada.js`. `inviteEmail` es a quién se
       * convoca —una sola dirección: convocar a una lista pide un modelo aparte
       * que hoy no hace falta— y `inviteSentAt` permite DECIR «ya se envió» en
       * vez de dejar a quien lo mira adivinando si pulsó.
       */
      meetUrl: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      inviteEmail: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      inviteSentAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "calendar_tasks",
      underscored: true,
      indexes: [
        { fields: ["client_id"], name: "calendar_tasks_client_id_idx" },
        { fields: ["team_member_id"], name: "calendar_tasks_team_member_id_idx" },
      ],
    }
  );
}
