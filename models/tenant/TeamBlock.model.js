import { DataTypes } from "sequelize";

/**
 * TeamBlock — «Vacaciones»: un tramo en el que alguien NO pasa consulta
 * (06/08/2026, Rodrigo).
 *
 * Rodrigo lo pidió como «un tipo de cita especial que no requiere paciente,
 * con fecha y hora de inicio y de fin, asignado a un miembro del equipo». En
 * la pantalla se crea así; POR DENTRO no es una cita, y a propósito.
 *
 * ⚠️ POR QUÉ NO ES UN `Booking`. Sería más rápido: una reserva ya ocupa el
 * hueco y no habría que tocar el cálculo. Pero hay mucho código leyendo
 * `bookings` —recordatorios, avisos de WhatsApp, cobros, «Mi perfil» de la
 * paciente, la lista de espera, la facturación—, y una reserva fantasma
 * llamada «Vacaciones» se colaría en todos: bastaría olvidar un guard en uno
 * para mandarle un recordatorio a nadie. Además `clientName` y `clientPhone`
 * son obligatorios, así que habría que inventarse una paciente.
 *
 * Como tabla aparte, el bloqueo solo lo ve quien calcula huecos y quien pinta
 * la agenda. Es el mismo camino que `blocked_days` (los festivos del centro),
 * con dos diferencias que son justo lo que pedía Rodrigo:
 *
 *   · va POR PERSONA — un festivo cierra el centro entero; unas vacaciones,
 *     no. Con `teamMemberId` a NULL vuelve a ser un cierre de todo el centro,
 *     que es lo que hace falta para una mudanza o una formación interna.
 *   · lleva HORA — «sale el viernes a las 14:00 y vuelve el lunes a las 10:00»
 *     no se puede contar con días sueltos, y `blocked_days` solo guarda fechas.
 *
 * LO QUE NO HACE, A PROPÓSITO (igual que los festivos): no toca las citas que
 * YA estaban en ese tramo. Cancelarlas automáticamente sería decidir por el
 * centro algo suyo —avisar, reubicar, cobrar o no—. Se siguen viendo y el
 * admin decide.
 */
export function defineTeamBlock(sequelize) {
  return sequelize.define(
    "TeamBlock",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      /**
       * Quién no está. NULL = no está NADIE: cierra el centro entero en ese
       * tramo, como un festivo pero con hora.
       */
      teamMemberId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // Instantes reales, no fecha + hora sueltas: así un tramo que cruza la
      // medianoche o dura tres semanas es UNA fila y se compara con un `<`.
      startAt: {
        type: DataTypes.DATE, // TIMESTAMP WITH TIME ZONE
        allowNull: false,
      },
      endAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      // "Vacaciones", "Baja", "Congreso"… Es lo que se ve en la agenda.
      label: {
        type: DataTypes.STRING(120),
        allowNull: false,
        defaultValue: "Vacaciones",
      },
      /**
       * DE QUÉ es el bloqueo (01/09/2026, Rodrigo): la clave de una de las
       * categorías del centro (`settings.citas.categoriasBloqueo`).
       *
       * Es una clave suelta y NO una FK: las categorías viven en el JSONB de
       * master, como las plantillas de informe o las especialidades de
       * derivación, así que aquí no hay tabla a la que apuntar. Eso además le
       * da la tolerancia que hace falta — borrar una categoría no puede
       * romper los bloqueos que la usaban: se quedan con una clave que ya no
       * está y vuelven a pintarse y a leerse como los de siempre.
       *
       * Nullable, y así nace: es opcional en todos los tenants y un bloqueo
       * sin categoría se comporta exactamente como antes de existir esto.
       */
      categoryKey: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      /**
       * El TALLER que se da en este tramo (01/09/2026, Rodrigo): «los talleres
       * hay que ponerlos y dejar claro que ahora salen como bloqueos y ya».
       *
       * Y era literal: HHSS, Grupo de Apoyo y Mente Activa se apuntan en la
       * agenda como un bloqueo con su nombre escrito a mano, así que la hora
       * queda ocupada y de lo que pasa dentro no queda nada. Con esto el
       * bloqueo deja de ser solo una hora tachada: sabe QUÉ taller es, y desde
       * él se registra la sesión del grupo (`taller_sesiones`).
       *
       * Sigue siendo un bloqueo y no una cita, por lo mismo de siempre (ver
       * arriba): un taller no tiene UN paciente al que mandarle el recordatorio.
       *
       * Nullable y sin FK dura: la inmensa mayoría de los bloqueos no son
       * talleres, y dar de baja un taller no puede borrar las horas que ya
       * estaban puestas en la agenda.
       */
      tallerId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      createdById: {
        type: DataTypes.UUID,
        allowNull: true,
      },
    },
    {
      tableName: "team_blocks",
      indexes: [
        // El camino que se recorre en cada cálculo de huecos: «bloqueos que
        // pisan este rango». Por fecha de fin, que es lo que descarta lo viejo.
        { fields: ["end_at"], name: "team_blocks_end_at_idx" },
        { fields: ["team_member_id"], name: "team_blocks_member_idx" },
      ],
      validate: {
        finDespuesDelInicio() {
          if (this.startAt && this.endAt && new Date(this.endAt) <= new Date(this.startAt)) {
            throw new Error("La fecha de fin tiene que ser posterior a la de inicio");
          }
        },
      },
    }
  );
}
