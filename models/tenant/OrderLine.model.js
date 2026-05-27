import { DataTypes } from "sequelize";

// Línea de un pedido. `outboundProductId` es referencia opcional al
// catálogo de inventario. `productName` es snapshot del nombre al
// momento de crear la línea (sobrevive a renombrados/borrados).
export function defineOrderLine(sequelize) {
  return sequelize.define(
    "OrderLine",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      orderId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      outboundProductId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      productName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      quantity: {
        type: DataTypes.DECIMAL(12, 3),
        allowNull: false,
        defaultValue: 1,
      },
      unitPrice: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      lineTotal: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "order_lines",
      indexes: [
        { fields: ["order_id"] },
        { fields: ["outbound_product_id"] },
      ],
    }
  );
}
