import { DataTypes } from "sequelize";

/**
 * TallerGrupo — UN grupo concreto de una actividad de taller (01/09/2026,
 * Aumenta por Rodrigo).
 *
 * ── EL ENCARGO ──────────────────────────────────────────────────────────────
 * «Los talleres no dejan de ser citas múltiples a las que van varios pacientes
 * a la vez y que pueden estar impartidas por varios terapeutas la misma cita.
 * […] En la propia pestaña de talleres se marca quién o quiénes imparten y qué
 * pacientes van.» Y, a media conversación, lo que parte el modelo en dos:
 * **«en los talleres hay que poder poner varios grupos distintos para la misma
 * actividad»**.
 *
 * ── POR QUÉ HACÍA FALTA PARTIRLO ────────────────────────────────────────────
 * Hasta hoy «Habilidades sociales» era UNA fila de `talleres` con 45 pacientes
 * apuntados, un horario de texto libre y una sola terapeuta. Y 45 niños no
 * caben en una sala: en el centro son varios grupos —por edad, por nivel, por
 * tarde—, cada uno con su hora, su gente y quien lo lleva.
 *
 * Con una sola fila no hay forma de decir eso. Cualquier intento acaba en el
 * mismo sitio: dar de alta «HHSS martes», «HHSS jueves» y «HHSS pequeños» como
 * tres talleres distintos, y entonces la ACTIVIDAD deja de existir como
 * concepto — no se puede preguntar cuánta gente hace habilidades sociales, ni
 * cobrar todos los grupos con el mismo concepto, ni cambiarle el nombre una
 * vez.
 *
 * Así que:
 *   · `talleres`      → LA ACTIVIDAD. Qué es, cómo se cobra. Cambia una vez al
 *                       año.
 *   · `taller_grupos` → EL GRUPO. Cuándo, quién lo da, quién va. Cambia cada
 *                       curso, y hay varios por actividad.
 *
 * Lo que se apunta en la agenda, lo que se cobra y lo que se registra es
 * siempre el GRUPO. La actividad es el paraguas.
 *
 * ── Y EL GRUPO ES UN TIPO DE CITA ───────────────────────────────────────────
 * «Hay que preparar los talleres de tal forma que en las citas se pueda
 * seleccionar los talleres. No como bloqueos sino como un tipo más de cita.
 * Solo que estos tipos de cita se crean desde la pestaña de talleres.»
 *
 * Cada grupo tiene su `EventType` —creado y mantenido desde la pestaña de
 * Talleres, nunca desde el catálogo de tipos de cita—, y el puntero vive en
 * `event_types.taller_grupo_id`: así el desplegable de tipos ya sabe cuáles son
 * talleres sin preguntar a nadie más. Ahí viven la duración, el color y el
 * nombre que se ve en la agenda; aquí, lo que es del grupo.
 *
 * Se marca `is_hidden` para que no se pueda reservar desde la web: a un taller
 * se entra apuntándose, no reservando hora.
 *
 * ── LO QUE NO ESTÁ AQUÍ ─────────────────────────────────────────────────────
 * Quién lo imparte (son VARIOS: `taller_grupo_terapeutas`) y quién va (son
 * varios y entran y salen: `taller_inscripciones`, que desde hoy cuelgan del
 * grupo y no de la actividad).
 */
export function defineTallerGrupo(sequelize) {
  return sequelize.define(
    "TallerGrupo",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      tallerId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      // «Grupo A», «Martes 17:00», «Pequeños». Es lo que distingue un grupo de
      // otro dentro de la misma actividad, y lo que se lee en la agenda detrás
      // del nombre del taller.
      name: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      // Texto libre («Martes 17:00-18:30»). Sigue siendo una nota para el
      // equipo, NO un horario que reserve nada: las horas de verdad son las
      // citas que se apuntan en la agenda.
      schedule: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      /**
       * Cuánto dura una sesión, en minutos. Es lo que se copia a la cita al
       * apuntarla, para no teclearlo cada semana. Los talleres de Aumenta son
       * de hora y media.
       */
      duration: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 90,
        validate: { min: 1, max: 480 },
      },
      // El color de la caja en la agenda. Null = el del taller / el de fábrica.
      color: {
        type: DataTypes.STRING(7),
        allowNull: true,
      },
      /**
       * Cuánta gente cabe. Solo informa —se avisa al pasarse, no se impide—:
       * un centro mete a un niño más en un grupo lleno y eso no lo decide el
       * CRM. Null = sin tope.
       */
      capacity: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 1 },
      },
      /**
       * El concepto del catálogo con el que se cobra ESTE grupo. Null = el de
       * la actividad (`talleres.concept_id`), que es el caso normal: dos grupos
       * de habilidades sociales cuestan lo mismo. Se separa porque un grupo
       * reducido o uno de refuerzo sí puede tener otro precio.
       *
       * Sin FK dura, como el del taller: borrar el concepto no rompe el grupo.
       */
      conceptId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // Se retira en vez de borrarse, por lo mismo que la actividad: sus
      // inscripciones, sus citas y sus registros siguen apuntando aquí.
      active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "taller_grupos",
      indexes: [
        { fields: ["taller_id"], name: "taller_grupos_taller_idx" },
        { fields: ["active"], name: "taller_grupos_active_idx" },
      ],
    }
  );
}
