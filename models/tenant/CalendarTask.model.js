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
      /*
       * El responsable PRINCIPAL. Desde el 01/09/2026 la lista de verdad vive
       * en `calendar_task_owners` (un evento puede tener varios responsables);
       * esta columna se queda como ESPEJO del primero, igual que
       * `Incidencia.assignedToId`, porque hay tres sitios que leen por ella:
       * «Mi trabajo» de la portada, el reparto de «Reorganizar la semana» y el
       * filtro `?teamMemberId=` del listado.
       */
      teamMemberId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      /*
       * De qué va el evento (01/09/2026): la categoría del catálogo que pone
       * cada centro (`CalendarCategory`). Nullable: un evento sin categoría es
       * perfectamente válido y se pinta por prioridad, que es como se ha
       * pintado siempre.
       */
      categoryId: {
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
        { fields: ["category_id"], name: "calendar_tasks_category_id_idx" },
      ],
    }
  );
}
