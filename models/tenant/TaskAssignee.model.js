import { DataTypes } from "sequelize";

/**
 * Relación N-a-N entre Task y TeamMember. Sprint 2 del módulo Proyectos
 * sustituye al campo legacy `Task.assigneeId` (1-a-1) por esta tabla
 * intermedia que permite múltiples asignados por tarea.
 *
 * El campo legacy `Task.assigneeId` se mantiene activo durante el sprint
 * por retrocompatibilidad (algunos endpoints/serializaciones pueden seguir
 * leyéndolo). Backlog Sprint 3: eliminar la columna y la asociación legacy
 * `assignee` cuando ningún consumidor la necesite.
 *
 * UNIQUE (taskId, teamMemberId) — un mismo team_member no puede estar
 * dos veces en la misma tarea.
 */
export function defineTaskAssignee(sequelize) {
  return sequelize.define(
    "TaskAssignee",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      taskId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      teamMemberId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      assignedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "task_assignees",
      indexes: [
        {
          fields: ["task_id", "team_member_id"],
          unique: true,
          name: "task_assignees_unique",
        },
        {
          fields: ["team_member_id"],
          name: "task_assignees_team_member_idx",
        },
      ],
    }
  );
}
