import { DataTypes } from "sequelize";

/**
 * Plan — plantilla nutricional o plan asignado a un paciente.
 *
 * Sprint nutri-laura Recetario C2.
 *
 *   type='template' → plantilla reutilizable (client_id NULL, assigned_at NULL).
 *   type='assigned' → plan asignado a un paciente concreto. Es una copia
 *                     deep del template (estructuras meals/options/foods
 *                     se duplican; el plan asignado vive independiente
 *                     y editar la plantilla origen NO le afecta).
 *
 * Self-FK `template_id` apunta al template origen cuando es asignado.
 * Soft delete vía `archived_at`. La integridad type / client_id /
 * assigned_at está reforzada por CHECK constraint
 * (plans_type_client_chk) en BD — la API también valida en entrada.
 */
export function definePlan(sequelize) {
  return sequelize.define(
    "Plan",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      type: {
        type: DataTypes.ENUM("template", "assigned"),
        allowNull: false,
      },
      templateId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: "template_id",
      },
      clientId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: "client_id",
      },
      visibleToClient: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: "visible_to_client",
      },
      assignedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "assigned_at",
      },
      // Comentarios por día de la semana (rediseño 2026-07-22): JSONB
      // { "1": "texto del lunes", … "7": "texto del domingo" }. Complementa a
      // `description` (comentarios generales del menú) y a
      // plan_meals.description (comentarios por comida).
      dayComments: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        field: "day_comments",
      },
      // ¿El PDF del paciente imprime proteínas/hidratos/grasas/fibra?
      // DEFAULT false a propósito (2026-07-22): Laura trata trastornos de la
      // conducta alimentaria, donde las cifras de macros suelen ser parte del
      // problema. Enseñarlas es una decisión consciente por menú; la
      // nutricionista las sigue viendo siempre en el editor del CRM.
      showMacros: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: "show_macros",
      },
      archivedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "archived_at",
      },
    },
    {
      tableName: "plans",
      indexes: [
        { fields: ["type"], name: "plans_type_idx" },
      ],
    }
  );
}
