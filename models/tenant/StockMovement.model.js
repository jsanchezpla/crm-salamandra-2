import { DataTypes } from "sequelize";

// Registro auditable de toda variación de stock sobre un InboundBatch.
// kg negativo = salida (consumo, venta, ajuste a la baja); positivo = reposición.
// reason describe el origen del movimiento. Los movimientos disparados por
// facturación llevan invoiceId/invoiceLineId rellenos.
export function defineStockMovement(sequelize) {
  return sequelize.define(
    "StockMovement",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      inboundBatchId: { type: DataTypes.UUID, allowNull: false },
      kg: { type: DataTypes.DECIMAL(10, 3), allowNull: false },
      reason: {
        type: DataTypes.ENUM("sale", "manual", "adjust", "historical"),
        allowNull: false,
        defaultValue: "manual",
      },
      invoiceId: { type: DataTypes.UUID, allowNull: true },
      invoiceLineId: { type: DataTypes.UUID, allowNull: true },
      outboundProductId: { type: DataTypes.UUID, allowNull: true },
      clientId: { type: DataTypes.UUID, allowNull: true },
      userId: { type: DataTypes.UUID, allowNull: true },
      movedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      notes: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: "stock_movements",
      indexes: [
        { fields: ["inboundBatchId"] },
        { fields: ["invoiceId"] },
        { fields: ["outboundProductId"] },
        { fields: ["clientId"] },
        { fields: ["movedAt"] },
      ],
    }
  );
}
