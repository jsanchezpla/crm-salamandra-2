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
 * Un paciente no puede estar apuntado DOS VECES a la vez al mismo taller, pero
 * sí puede volver a apuntarse el curso siguiente. Por eso el único cubre solo
 * las inscripciones abiertas (`leftAt IS NULL`), y se declara en la migración:
 * Sequelize no sabe expresar un índice parcial de Postgres.
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
      patientId: {
        type: DataTypes.UUID,
        allowNull: false,
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
        { fields: ["patient_id"], name: "taller_inscripciones_patient_idx" },
      ],
    }
  );
}
