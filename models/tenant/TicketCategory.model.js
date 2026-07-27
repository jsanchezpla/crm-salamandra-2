import { DataTypes } from "sequelize";

/**
 * Categoría de tickets, configurable por el propio tenant (facturación,
 * técnico, pedidos...): cada negocio llama a lo suyo de forma distinta.
 * `color` es un token de color hex para el chip de la bandeja.
 */
export function defineTicketCategory(sequelize) {
  return sequelize.define(
    "TicketCategory",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(80),
        allowNull: false,
      },
      color: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      sortOrder: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      tableName: "ticket_categories",
    }
  );
}
