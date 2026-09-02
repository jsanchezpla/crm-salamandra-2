import { DataTypes } from "sequelize";

/**
 * TallerSesion — UNA sesión de un taller, con su registro, para TODO el grupo
 * (01/09/2026, Aumenta por Rodrigo).
 *
 * ── EL ENCARGO ──────────────────────────────────────────────────────────────
 * «Hay que poner que estos talleres puedan tener registro de sesión y afecta a
 * un grupo de pacientes. A todos les saldrá el registro en sus sesiones como
 * parte del taller y que se pueda poner un apartado para cada paciente y que
 * solo le salga a él. Es decir, el registro general el mismo a todos menos el
 * apartado extra privado para cada paciente.»
 *
 * Hoy los talleres de Aumenta —HHSS (Habilidades Sociales), Grupo de Apoyo y
 * Mente Activa— se apuntan en la agenda como un bloqueo y ahí se acaba: la hora
 * queda ocupada y de lo que se hizo dentro no queda nada. Ocho pacientes, hora
 * y media, y ni una línea en la historia de ninguno.
 *
 * ── LA PIEZA QUE FALTABA: EL REGISTRO ES DEL GRUPO ──────────────────────────
 * Lo que se escribe de un taller es UNO y es el mismo para los ocho: qué se
 * trabajó, qué actividades, cómo fue. Escribirlo ocho veces sería ocho ratos y
 * ocho versiones distintas de la misma tarde. Por eso el registro común vive
 * AQUÍ, en una fila por sesión de taller, y no repetido en cada paciente:
 * corregirlo se hace una vez y llega a los ocho.
 *
 * Lo que NO es del grupo es la nota de cada cual —«hoy participó», «se levantó
 * dos veces»—, y esa es la mitad delicada del encargo: son ocho familias
 * distintas. Vive en la sesión de CADA paciente (`clinic_sessions`), con su
 * clave propia, y no pasa por aquí en ningún momento.
 *
 * ── POR QUÉ ADEMÁS SE COPIA A CADA PACIENTE ─────────────────────────────────
 * Cada asistente tiene su propia fila en `clinic_sessions` apuntando aquí
 * (`taller_sesion_id`), con el cuerpo común ya escrito dentro. Duplica texto a
 * propósito, y la razón es que «le sale en SUS sesiones» tiene que ser verdad
 * hasta el final: el informe evolutivo, el anexo del PDF, las estadísticas del
 * centro, el volcado que redacta el borrador y el envío al área privada leen
 * `clinic_sessions` por sus columnas de siempre. Con el texto solo aquí, un
 * paciente que va a HHSS todo el curso tendría el taller en la pantalla y no en
 * su informe, que es justo donde hace falta.
 *
 * La copia no es una segunda fuente: se REESCRIBE entera cada vez que se guarda
 * la sesión del taller (`lib/clinica/tallerSesion.js`), respetando siempre la
 * nota individual. Manda esta fila; las de los pacientes son su reflejo.
 *
 * ── POR QUÉ NO ES UN `ClinicSession` MÁS ────────────────────────────────────
 * Porque una sesión clínica es de UN paciente: `patient_id` es obligatorio y de
 * ahí cuelga media aplicación. Una sesión de taller no es de nadie en concreto
 * —es del grupo—, y meterla en esa tabla obligaría a inventarle un paciente
 * dueño, que es exactamente el enredo que ya se evitó con los bloqueos de
 * agenda (ver `TeamBlock.model.js`).
 */
export function defineTallerSesion(sequelize) {
  return sequelize.define(
    "TallerSesion",
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
      /**
       * El GRUPO del que es esta sesión (01/09/2026). La actividad no da
       * sesiones: las da el grupo de los martes, con su gente. Nullable por las
       * sesiones anteriores a que existieran los grupos (en producción, cero) y
       * porque el modelo la declara para todos los tenants.
       */
      grupoId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      /**
       * LA CITA de la que sale (01/09/2026, Rodrigo: los talleres pasan a ser
       * «un tipo más de cita», no un bloqueo).
       *
       * Es el equivalente de `clinic_sessions.booking_id` y responde a lo mismo
       * —**una cita, un registro**—: entrar y salir del taller de esa tarde
       * tiene que seguir editando el mismo registro, no crear uno nuevo cada
       * vez. Aquí manda todavía más que en una sesión individual, porque de
       * este registro cuelgan las copias de los ocho asistentes: un segundo
       * registro de la misma tarde partiría el grupo en dos.
       *
       * Sin FK dura, como `teamBlockId`: borrar la cita del calendario no puede
       * llevarse por delante lo que se escribió del taller.
       */
      bookingId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      /**
       * Quién la dio. Nullable por lo mismo que en `ClinicSession`: un taller
       * puede haberlo llevado alguien que ya no está en el centro, y una nota
       * sin firma sigue siendo el registro de lo que se hizo.
       */
      teamMemberId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      sessionDate: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      // Minutos. Los talleres de Aumenta son de hora y media; se apunta para
      // que Productividad pueda contarlos igual que el resto.
      duration: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 1 },
      },
      /**
       * EL REGISTRO COMÚN, por apartados, con el mismo mecanismo que el registro
       * de sesión de un paciente (`lib/clinica/plantillas.js`): la foto de con
       * qué apartados se escribió más el cuerpo de cada uno.
       *
       * Aquí va TODO el cuerpo, también el de los apartados de fábrica, y no
       * repartido en columnas como en `clinic_sessions`. La razón es que de esta
       * tabla no come nadie más: el informe, las estadísticas y el anexo leen las
       * columnas de la sesión DEL PACIENTE, que es donde se copia. Partirlo aquí
       * también sería mantener el mismo reparto en dos sitios sin ganar nada.
       */
      contentSections: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      /**
       * Lo que el equipo anota para sí mismo del GRUPO y ninguna familia debe
       * leer. Misma regla que `ClinicSession.internalNotes`: material interno,
       * no sale del CRM — y por eso NO se copia a la sesión de ningún paciente.
       */
      internalNotes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      /**
       * ── De qué TEXTO salió este registro (03/09/2026, Rodrigo: «añade
       * audio e IA a la sesión de taller») ─────────────────────────────
       *
       * Lo mismo que `clinic_sessions.ai_transcription`: la transcripción del
       * audio del taller, las notas pegadas, o las dos. Se guarda para que la
       * IA se pueda volver a pasar sin subir el audio otra vez, y como
       * constancia. Material del equipo: no se propaga a los pacientes ni
       * sale en ningún PDF. Null en todo lo escrito antes de esa fecha.
       * `audio_duration_sec` la mide Whisper; null sin audio.
       */
      aiTranscription: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "ai_transcription",
      },
      audioDurationSec: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "audio_duration_sec",
      },
      /**
       * El bloqueo de agenda del que salió, cuando se registra desde ahí. Sin FK
       * dura y nullable: quitar el bloqueo de la agenda no puede borrar lo que
       * se escribió del taller, y una sesión se puede registrar sin que nadie
       * hubiera bloqueado la hora.
       */
      teamBlockId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // 'registered' (guardada) · 'published' (cerrada, como en ClinicSession:
      // cierra el registro para el equipo, no lo comparte con las familias).
      status: {
        type: DataTypes.ENUM("registered", "published"),
        allowNull: false,
        defaultValue: "registered",
      },
      createdById: {
        type: DataTypes.UUID,
        allowNull: true,
      },
    },
    {
      tableName: "taller_sesiones",
      indexes: [
        { fields: ["taller_id", "session_date"], name: "taller_sesiones_taller_fecha_idx" },
        { fields: ["team_member_id"], name: "taller_sesiones_member_idx" },
        { fields: ["grupo_id", "session_date"], name: "taller_sesiones_grupo_fecha_idx" },
        // «¿Esta cita ya tiene registro?», que se pregunta al abrir el modal de
        // cada taller de la agenda. Mismo camino que en `clinic_sessions`.
        { fields: ["booking_id"], name: "taller_sesiones_booking_idx" },
      ],
    }
  );
}
