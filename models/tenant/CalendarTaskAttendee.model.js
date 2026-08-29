import { DataTypes } from "sequelize";

/*
 * A quién AFECTA un evento del Calendario, uno por fila (29/08/2026, Rodrigo).
 *
 * `CalendarTask.teamMemberId` sigue siendo el RESPONSABLE (quién lo hace); esto
 * es la lista de convocados: los miembros del equipo que tienen que verlo. Es
 * el «modelo aparte» que la decisión de la videollamada (27/08/2026) dejó
 * anunciado para cuando hiciera falta convocar a una lista. Patrón TaskAssignee.
 *
 * `googleEventId` es el id de la COPIA de este evento en el calendario
 * «CRM Salamandra» de ESE miembro (Google Calendar, ver
 * lib/calendar/googleSync.js). Va en la fila del asistente y no en la tarea
 * porque cada persona tiene su propio calendario y su propia copia: la misma
 * tarea vive con un id distinto en cada Google.
 */
export function defineCalendarTaskAttendee(sequelize) {
  return sequelize.define(
    "CalendarTaskAttendee",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      taskId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      teamMemberId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      googleEventId: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
    },
    {
      tableName: "calendar_task_attendees",
      underscored: true,
      indexes: [
        {
          unique: true,
          fields: ["task_id", "team_member_id"],
          name: "calendar_task_attendees_unique",
        },
        { fields: ["team_member_id"], name: "calendar_task_attendees_member_idx" },
      ],
    }
  );
}
