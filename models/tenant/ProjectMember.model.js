import { DataTypes } from "sequelize";

/**
 * Pertenencia de un TeamMember a un Project con un rol concreto.
 *
 * Roles:
 *   - lead: responsable del proyecto. Puede haber varios co-leads (no se
 *     fuerza unicidad a nivel BD; validación opcional a nivel aplicación).
 *   - member: miembro estándar del equipo del proyecto.
 *   - viewer: solo lectura.
 *
 * Borrado en cascada con el proyecto. En Sprint 1 quitar miembro = DELETE
 * real. El soft remove (`removedAt`) se introducirá en Sprint 4 cuando entre
 * TimeEntry y haya histórico de imputaciones que preservar.
 */
export function defineProjectMember(sequelize) {
  return sequelize.define(
    "ProjectMember",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      projectId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      teamMemberId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      role: {
        type: DataTypes.ENUM("lead", "member", "viewer"),
        allowNull: false,
        defaultValue: "member",
      },
      joinedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "project_members",
      indexes: [
        {
          fields: ["project_id", "team_member_id"],
          unique: true,
          name: "project_members_project_team_unique",
        },
      ],
    }
  );
}
