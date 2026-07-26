import { DataTypes } from "sequelize";

/**
 * TeamMemberHours — horario de trabajo semanal PROPIO de un miembro del equipo
 * (profesional).
 *
 * Distinto de `Availability`, que es del CENTRO (o por tipo de cita) y alimenta
 * la reserva pública. Esto es el horario de CADA terapeuta: los días y franjas
 * en que trabaja. La generación de huecos para proponer/reprogramar citas de un
 * profesional usa SU horario (este modelo) menos SUS citas ya puestas.
 *
 * Convención de días = `Date.prototype.getDay()` (0=domingo..6=sábado), igual que
 * Availability. Horas en TIME sin TZ, interpretadas como hora local Europe/Madrid.
 *
 * Un miembro puede tener varias filas por día (p. ej. 09:00-14:00 y 16:00-20:00).
 * Sin filas = "sin horario propio configurado" → el generador de huecos cae al
 * horario general del centro (Availability) para ese profesional.
 */
export function defineTeamMemberHours(sequelize) {
  return sequelize.define(
    "TeamMemberHours",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      teamMemberId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      // 0=domingo .. 6=sábado (convención JS getDay)
      dayOfWeek: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 0, max: 6 },
      },
      startTime: {
        type: DataTypes.TIME,
        allowNull: false,
      },
      endTime: {
        type: DataTypes.TIME,
        allowNull: false,
      },
    },
    {
      tableName: "team_member_hours",
      indexes: [
        { fields: ["team_member_id", "day_of_week"], name: "team_member_hours_member_day_idx" },
      ],
    }
  );
}
