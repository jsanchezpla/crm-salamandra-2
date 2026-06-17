import { DataTypes } from "sequelize";

/**
 * CourseRegistration — formulario inicial completado por el alumno antes de
 * acceder a un curso. Sprint nuevo (junio 2026) para Retorika: alumnos del
 * curso "Liderazgo Educativo" rellenan datos del centro, perfil docente y
 * un diagnóstico inicial. El registro es OBLIGATORIO para la bonificación
 * FUNDAE; el PHP en WP redirige a la página del form si no existe registro.
 *
 * Auto-vinculación al crear:
 *   - trainingUserId: find-or-create TrainingUser por email (case-insensitive).
 *   - courseId: lookup Course por wpCourseId.
 *   - companyId: lookup Company por nif (matching exacto del NIF del centro).
 *     Fallback: si el NIF no resuelve, se hereda de TrainingUser.companyId
 *     (vinculación manual previa), de modo que alumnos ya conocidos del CRM
 *     no aparezcan como "sin empresa" si el form viene con NIF vacío o typo.
 *
 * Idempotencia: el endpoint que crea registros considera duplicado el par
 * (email, wpProductId) — si ya existe, devuelve alreadyExists=true sin
 * crear fila nueva.
 */
export function defineCourseRegistration(sequelize) {
  return sequelize.define(
    "CourseRegistration",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      trainingUserId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      courseId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      companyId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      email: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: { isEmail: true },
      },
      wpUserId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      wpProductId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      wpCourseId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      submittedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      // NIF del centro (alineado con Company.nif y TrainingUser.nif).
      centerNif: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      centerName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      // Datos completos del centro: { type, name, otherName, address: {...}, nif }
      centerData: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
      // Perfil docente: { yearsOfExperience, positions: [], coursesTeaching: [], subjects: [], topicsOfInterest: [] }
      teacherData: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
      // Diagnóstico inicial: { motivationCurrent, motivationVsStart, centerEnvironment, stressLevel, ... }
      diagnosisData: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
      // Snapshot completo del POST original — diagnóstico ante cambios de esquema.
      rawPayload: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
    },
    {
      tableName: "course_registrations",
      hooks: {
        beforeSave(instance) {
          if (instance.email) instance.email = instance.email.toLowerCase().trim();
        },
      },
    }
  );
}
