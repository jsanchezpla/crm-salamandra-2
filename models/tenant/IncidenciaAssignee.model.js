import { DataTypes } from "sequelize";

/**
 * Relación N-a-N entre Incidencia y TeamMember (sprint Aumenta 2026-07-28):
 * una incidencia puede tener VARIOS responsables. Mismo patrón que
 * TaskAssignee en Proyectos.
 *
 * El campo legacy `Incidencia.assignedToId` se mantiene como espejo del
 * primer responsable por retrocompatibilidad (filtros `?assignedToId=` y
 * consumidores antiguos). Backlog: retirarlo cuando nadie lo lea.
 */
export function defineIncidenciaAssignee(sequelize) {
  return sequelize.define(
    "IncidenciaAssignee",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      incidenciaId: {
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
      tableName: "incidencia_assignees",
      indexes: [
        {
          fields: ["incidencia_id", "team_member_id"],
          unique: true,
          name: "incidencia_assignees_unique",
        },
        { fields: ["team_member_id"], name: "incidencia_assignees_team_member_idx" },
      ],
    }
  );
}
