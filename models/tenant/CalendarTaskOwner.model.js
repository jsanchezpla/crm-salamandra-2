import { DataTypes } from "sequelize";

/*
 * Quién SE ENCARGA de un evento del Calendario, uno por fila (01/09/2026,
 * Rodrigo: «más de un responsable por cada tarea, además de a quién afecta»).
 *
 * Las dos listas son distintas y hacen falta las dos:
 *   · RESPONSABLES (esto) — quién lo hace. Puede ser más de uno: una
 *     coordinación la preparan dos terapeutas.
 *   · AFECTA A (`CalendarTaskAttendee`) — a quién le toca verlo. Es lo que
 *     decide en qué Google Calendar aparece una copia del evento.
 * Una persona puede estar en las dos, y estar en una no mete en la otra: un
 * responsable que no quiera el evento en su Google no tiene por qué tenerlo.
 *
 * Patrón `TaskAssignee` / `IncidenciaAssignee`, y como en Incidencias
 * `CalendarTask.teamMemberId` se queda de ESPEJO DEL PRINCIPAL —el primero de
 * la lista— para que lo que ya leía esa columna siga leyendo algo cierto:
 * «Mi trabajo» de la portada, el reparto de «Reorganizar la semana» y el
 * filtro `?teamMemberId=` del listado.
 */
export function defineCalendarTaskOwner(sequelize) {
  return sequelize.define(
    "CalendarTaskOwner",
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
    },
    {
      tableName: "calendar_task_owners",
      underscored: true,
      indexes: [
        {
          unique: true,
          fields: ["task_id", "team_member_id"],
          name: "calendar_task_owners_unique",
        },
        { fields: ["team_member_id"], name: "calendar_task_owners_member_idx" },
      ],
    }
  );
}
