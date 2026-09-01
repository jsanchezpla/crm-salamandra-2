import { DataTypes } from "sequelize";

/**
 * TallerGrupoTerapeuta — quién imparte un grupo de taller (01/09/2026, Aumenta
 * por Rodrigo: «pueden estar impartidas por varios terapeutas la misma cita»).
 *
 * ── POR QUÉ UNA TABLA Y NO UNA COLUMNA ──────────────────────────────────────
 * `talleres.team_member_id` guardaba UNA persona, que es lo que hacía falta
 * mientras el taller solo era una línea en una lista. Deja de valer en cuanto
 * el taller ocupa una hora de la agenda: si la cita es de una sola terapeuta,
 * la otra no la ve en su calendario, no le cuenta en Productividad y no aparece
 * como que estuvo allí. Y estuvo.
 *
 * ── LO QUE ARRASTRA, Y ES LO IMPORTANTE ─────────────────────────────────────
 * La agenda de cada cual se filtra por `bookings.team_member_id`
 * (`lib/citas/visibilidad.js`). Una cita de taller lleva ahí a quien lo
 * coordina —hace falta un dueño para el color y para los filtros—, así que sin
 * esta tabla el resto del equipo tendría el taller escondido. Con ella, la
 * agenda pregunta además «¿soy uno de los que lo imparten?» y la caja sale en
 * el calendario de los dos.
 *
 * ── SE COPIA A LA CITA, NO SE LEE DESDE ELLA ────────────────────────────────
 * Esto es la plantilla del grupo: quién lo lleva HABITUALMENTE. Quién dio una
 * tarde concreta puede ser otra persona (una sustitución), y eso vive en la
 * cita (`taller_cita_terapeutas`) y en el registro de la sesión. Al apuntar la
 * cita se copia de aquí, y a partir de ahí cada una va por su cuenta: cambiar
 * el grupo en enero no puede reescribir quién dio el taller en octubre.
 */
export function defineTallerGrupoTerapeuta(sequelize) {
  return sequelize.define(
    "TallerGrupoTerapeuta",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      grupoId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      teamMemberId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      /**
       * Quién es el de referencia del grupo. Es el que se pone como dueño de
       * la cita (`bookings.team_member_id`) y del que sale el color de la caja.
       * Uno solo por grupo; el índice único parcial lo garantiza y se declara
       * en la migración, que Sequelize no sabe expresarlo.
       */
      coordina: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      tableName: "taller_grupo_terapeutas",
      indexes: [
        { fields: ["grupo_id"], name: "taller_grupo_terapeutas_grupo_idx" },
        { fields: ["team_member_id"], name: "taller_grupo_terapeutas_member_idx" },
      ],
    }
  );
}
