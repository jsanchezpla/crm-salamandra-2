import { DataTypes } from "sequelize";

/**
 * Incidencia — registro del sistema de incidencias del "Programa de Excelencia"
 * (módulo Clínica). Una incidencia es un hecho a resolver: terapéutico,
 * organizativo, documental, administrativo, etc.
 *
 * Categorías fijas (taxonomía en lib/clinica/incidencias.js) + subcategoría libre
 * (p. ej. administrativa → Diagnóstico / Impagados / Facturación). Estados:
 * Pendiente → En proceso → Resuelta. Responsable = miembro del equipo asignado.
 * Los comentarios se guardan como hilo en `comments` (JSONB).
 *
 * Enums con nombre `enum_incidencias_<col>` para casar con lo que crea la
 * migración migrate-incidencias-module.js.
 */
export function defineIncidencia(sequelize) {
  return sequelize.define(
    "Incidencia",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      incidenceDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      title: {
        type: DataTypes.STRING(200),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      category: {
        type: DataTypes.ENUM(
          "terapeutica",
          "organizativa",
          "documental",
          "administrativa",
          "tecnologica",
          "comunicativa",
          "coordinacion",
          "informacion"
        ),
        allowNull: false,
      },
      subcategory: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("pending", "in_progress", "resolved"),
        allowNull: false,
        defaultValue: "pending",
      },
      priority: {
        type: DataTypes.ENUM("low", "medium", "high"),
        allowNull: false,
        defaultValue: "medium",
      },
      // Paciente al que se refiere (opcional; no toda incidencia es de un paciente).
      patientId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // Cliente/pagador (foto, consistente con el resto de registros clínicos).
      clientId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // Responsable de resolverla (miembro del equipo).
      assignedToId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // Quién la registró.
      reportedById: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // Hilo de comentarios: [{ authorId, authorName, text, at }].
      comments: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      // Acción realizada para resolverla. Existía desde el principio pero no
      // había forma de escribirla: el formulario no la enseñaba (04/08/2026).
      resolution: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Verificación del resultado (Aumenta, 04/08/2026). NULL = nadie lo ha
      // comprobado todavía. Gobierna `status`: ver lib/clinica/incidencias.js.
      verification: {
        type: DataTypes.STRING(20),
        allowNull: true,
        validate: { isIn: [["resuelta", "parcial", "no_resuelta"]] },
      },
      resolvedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // La FALTA dentro de la incidencia (03/09/2026, AV-0038). NULL = una
      // incidencia de las de siempre; con objeto, es una falta y vive en la
      // pestaña «Faltas». Forma y reglas en lib/clinica/faltas.js.
      falta: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
    },
    {
      tableName: "incidencias",
      indexes: [
        { fields: ["status"], name: "incidencias_status_idx" },
        { fields: ["category"], name: "incidencias_category_idx" },
        { fields: ["patient_id"], name: "incidencias_patient_idx" },
        { fields: ["assigned_to_id"], name: "incidencias_assigned_idx" },
        { fields: ["incidence_date"], name: "incidencias_date_idx" },
      ],
    }
  );
}
