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
      // «Visto»: esta persona ya hizo SU parte (04/09/2026, Rodrigo). NULL =
      // sigue pendiente para ella. No cierra la incidencia —eso es `status`,
      // y es de todas—: solo la aparta de SU bandeja, su campana y su portada.
      // Una actualización lo vuelve a poner a NULL y la incidencia le
      // reaparece. Las reglas, en `lib/clinica/vistoIncidencia.js`.
      vistoAt: {
        type: DataTypes.DATE,
        allowNull: true,
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
