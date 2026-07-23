import { DataTypes } from "sequelize";

export function defineInteraction(sequelize) {
  return sequelize.define(
    "Interaction",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      clientId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      type: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "note",
      },
      content: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      createdBy: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // Miembro del equipo que registró la interacción (2026-07-23). Enlace
      // real, frente a `createdBy` que es solo texto. Permite ver "las
      // interacciones de tal comercial".
      teamMemberId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: "team_member_id",
      },
    },
    {
      tableName: "interactions",
    }
  );
}
