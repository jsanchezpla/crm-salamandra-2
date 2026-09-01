import { DataTypes } from "sequelize";

/**
 * TallerCitaTerapeuta — quién impartió UNA tarde concreta de taller
 * (01/09/2026, Aumenta por Rodrigo).
 *
 * ── POR QUÉ NO BASTA CON LOS DEL GRUPO ──────────────────────────────────────
 * `taller_grupo_terapeutas` dice quién lleva el grupo este curso. Esto dice
 * quién estuvo el 14 de octubre. Casi siempre es lo mismo, y por eso se copia
 * de allí al apuntar la cita — pero no siempre: alguien se pone malo y entra
 * otra, se refuerza un día suelto, o a mitad de curso cambia quien lo da.
 *
 * Si no se separaran, cambiar el grupo en enero reescribiría la historia:
 * Productividad diría que la sustituta no dio nunca ese taller, y quien lo dio
 * de verdad aparecería en tardes en las que no estaba. Una tabla al lado de la
 * cita es lo que hace que el pasado se quede quieto.
 *
 * ── PARA QUÉ SE LEE ─────────────────────────────────────────────────────────
 *   · La AGENDA de cada terapeuta: la caja del taller sale en el calendario de
 *     todos los que lo dan, no solo en el de quien figura como dueño de la cita
 *     (`lib/citas/visibilidad.js` + `lib/clinica/talleresDeCita.js`).
 *   · El REGISTRO de la sesión: el desplegable de «quién lo hizo» arranca por
 *     estos, que son los que estuvieron.
 *
 * Sin FK dura a `team_members` por lo de siempre; con CASCADE sobre la cita, en
 * cambio, sí: borrada la cita, esta fila no significa nada.
 */
export function defineTallerCitaTerapeuta(sequelize) {
  return sequelize.define(
    "TallerCitaTerapeuta",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      bookingId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      teamMemberId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
    },
    {
      tableName: "taller_cita_terapeutas",
      indexes: [
        { fields: ["booking_id"], name: "taller_cita_terapeutas_booking_idx" },
        { fields: ["team_member_id"], name: "taller_cita_terapeutas_member_idx" },
      ],
    }
  );
}
