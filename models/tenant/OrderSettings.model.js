import { DataTypes } from "sequelize";

// Configuración del módulo Pedidos por tenant. Una sola fila (singleton)
// con campos sencillos. Si se complica más adelante, se promociona a una
// estructura key/value JSONB. Por ahora, transporte + IVA bastan.
export function defineOrderSettings(sequelize) {
  return sequelize.define(
    "OrderSettings",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      transportPrice: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      transportVatRate: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: false,
        defaultValue: 21,
      },
      defaultVatRate: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: false,
        defaultValue: 21,
      },
    },
    {
      tableName: "order_settings",
    }
  );
}
