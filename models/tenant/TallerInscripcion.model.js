import { DataTypes } from "sequelize";

/**
 * TallerInscripcion — un paciente apuntado a un taller.
 *
 * ── Por qué hay fecha de alta y de baja, y no un booleano ──────────────────
 *
 * Un paciente entra y sale de un taller a lo largo de los cursos. Con un
 * `activo: true/false` se perdería CUÁNDO estuvo, que es justo lo que hace falta
 * para entender su historial ("estuvo en Habilidades Sociales el curso pasado").
 *
 * `leftAt` a null = sigue apuntado. Darse de baja NO borra la fila.
 *
 * ── El índice único es parcial, a propósito ────────────────────────────────
 *
 * Un paciente no puede estar apuntado DOS VECES a la vez al mismo GRUPO, pero
 * sí puede volver a apuntarse el curso siguiente. Por eso el único cubre solo
 * las inscripciones abiertas (`leftAt IS NULL`), y se declara en la migración:
 * Sequelize no sabe expresar un índice parcial de Postgres.
 *
 * Desde el 01/09/2026 el único va por GRUPO y no por actividad, y la diferencia
 * es deliberada: estar en dos grupos de habilidades sociales a la vez —uno de
 * refuerzo y el de siempre— es raro pero legítimo, y prohibirlo obligaría a
 * dar de baja a un niño para poder meterlo en el otro.
 */
export function defineTallerInscripcion(sequelize) {
  return sequelize.define(
    "TallerInscripcion",
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
       * EL GRUPO al que va (01/09/2026, Rodrigo: «hay que poder poner varios
       * grupos distintos para la misma actividad»).
       *
       * Un paciente no se apunta a «habilidades sociales»: se apunta al grupo
       * de los martes a las cinco, que es el que tiene hora, terapeuta y sitio
       * en la sala. `tallerId` SE QUEDA —es la actividad, y es por lo que se
       * pregunta «¿cuántos niños hacen habilidades sociales?»— y se rellena
       * solo con el taller del grupo.
       *
       * Nullable en el modelo por las 45 inscripciones de Aumenta que nacieron
       * antes de que hubiera grupos: la migración les pone el grupo que se creó
       * con el taller, y a partir de ahí la pantalla no deja apuntar sin grupo.
       */
      grupoId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      patientId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      /**
       * LA CUOTA que se le dio de alta al apuntarlo (01/09/2026, Rodrigo:
       * «estos pacientes tendrán que estar relacionados entre sí dentro de una
       * misma cuota de talleres, así se complementan la zona de pago, las citas
       * y los registros»).
       *
       * Apuntar a un niño a un grupo le crea a SU familia una cuota mensual con
       * el concepto de cobro del taller, y darlo de baja la cierra. Este
       * puntero es lo que hace posible la segunda mitad: sin él habría que
       * adivinar cuál de las cuotas de esa familia era la del taller, y con dos
       * hermanos en dos grupos no hay forma de adivinarlo.
       *
       * Sin FK dura y nullable: una cuota borrada a mano no puede llevarse por
       * delante la inscripción, y un taller sin concepto de cobro —o un centro
       * sin Facturación— apunta gente sin cobrar nada.
       */
      cuotaId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      joinedAt: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      // null = sigue apuntado. Ver cabecera.
      leftAt: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "taller_inscripciones",
      indexes: [
        { fields: ["taller_id"], name: "taller_inscripciones_taller_idx" },
        { fields: ["grupo_id"], name: "taller_inscripciones_grupo_idx" },
        { fields: ["patient_id"], name: "taller_inscripciones_patient_idx" },
      ],
    }
  );
}
