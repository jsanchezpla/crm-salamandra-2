import { DataTypes } from "sequelize";

/**
 * BlockedDay — festivo o día bloqueado del centro (sprint Aumenta 2026-07-28).
 *
 * Marcado A MANO por el admin en el calendario. Afecta a todo el tenant:
 * ese día no se generan huecos de reserva (lib/citas/slots.js) y no se
 * permiten citas manuales. Las citas YA existentes en ese día no se tocan:
 * el admin decide qué hacer con ellas.
 */
export function defineBlockedDay(sequelize) {
  return sequelize.define(
    "BlockedDay",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        unique: true,
      },
      // "Festivo local", "Cierre por formación"… Se muestra en el calendario.
      label: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      createdById: {
        type: DataTypes.UUID,
        allowNull: true,
      },
    },
    {
      tableName: "blocked_days",
      indexes: [{ fields: ["date"], unique: true, name: "blocked_days_date_unique" }],
    }
  );
}
