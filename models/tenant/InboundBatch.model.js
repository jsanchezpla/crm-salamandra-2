import { DataTypes } from "sequelize";

// Una InboundBatch representa una entrega concreta de un proveedor de un
// InboundProduct: lleva fecha, lote, cantidad recibida, cuánto queda y precio.
// El stock real de un InboundProduct se calcula sumando kgRemaining de sus batches.
export function defineInboundBatch(sequelize) {
  return sequelize.define(
    "InboundBatch",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      inboundProductId: { type: DataTypes.UUID, allowNull: false },
      supplier: { type: DataTypes.STRING, allowNull: false },
      lot: { type: DataTypes.STRING, allowNull: true },
      entryDate: { type: DataTypes.DATEONLY, allowNull: true },
      kg: { type: DataTypes.DECIMAL(10, 3), allowNull: false, defaultValue: 0 },
      kgRemaining: { type: DataTypes.DECIMAL(10, 3), allowNull: false, defaultValue: 0 },
      packaging: { type: DataTypes.STRING, allowNull: true },
      purchasePrice: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
      // Trazabilidad de migración desde inventory_products. Permite saltar filas
      // ya migradas en re-ejecuciones del script.
      legacyInventoryProductId: { type: DataTypes.UUID, allowNull: true },
    },
    {
      tableName: "inbound_batches",
      indexes: [
        { fields: ["inboundProductId"] },
        { fields: ["entryDate"] },
        { fields: ["legacyInventoryProductId"] },
      ],
    }
  );
}
