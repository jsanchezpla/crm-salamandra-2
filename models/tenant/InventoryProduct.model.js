import { DataTypes } from "sequelize";

export function defineInventoryProduct(sequelize) {
  return sequelize.define(
    "InventoryProduct",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      // Entrada
      supplier: { type: DataTypes.STRING, allowNull: true },
      entryDate: { type: DataTypes.DATEONLY, allowNull: true },
      productName: { type: DataTypes.STRING, allowNull: false },
      units: { type: DataTypes.INTEGER, allowNull: true },
      kg: { type: DataTypes.DECIMAL(10, 3), allowNull: true },
      packaging: { type: DataTypes.STRING, allowNull: true },
      lot: { type: DataTypes.STRING, allowNull: true },
      purchasePrice: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      // Salida
      outputName: { type: DataTypes.STRING, allowNull: true },
      clientId: { type: DataTypes.UUID, allowNull: true },
      exitDate: { type: DataTypes.DATEONLY, allowNull: true },
      outputKg: { type: DataTypes.DECIMAL(10, 3), allowNull: true },
      salePrice: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      // Estado
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "stock",
      },
      notes: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: "inventory_products",
    }
  );
}
