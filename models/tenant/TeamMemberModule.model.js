import { DataTypes } from "sequelize";

/**
 * TeamMemberModule — módulos asignados a un miembro del equipo (config a nivel
 * de TeamMember del tenant).
 *
 * ⚠️ NO confundir con `master.users.moduleAccess` (JSONB en el schema master),
 * que es lo que controla el ACCESO REAL de LOGIN al CRM vía `hasModule()`.
 * Esta tabla es puramente informativa/organizativa por ahora: NO bloquea nada
 * (el gate real es un sprint futuro). Un TeamMember puede no tener User (userId
 * nullable), así que este eje es independiente del login.
 *
 * Tabla `team_member_modules`, única por (team_member_id, module_key).
 */
export function defineTeamMemberModule(sequelize) {
  return sequelize.define(
    "TeamMemberModule",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      teamMemberId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      moduleKey: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      tableName: "team_member_modules",
      indexes: [
        { unique: true, fields: ["team_member_id", "module_key"], name: "team_member_modules_uq" },
        { fields: ["team_member_id"], name: "team_member_modules_team_member_idx" },
      ],
    }
  );
}
