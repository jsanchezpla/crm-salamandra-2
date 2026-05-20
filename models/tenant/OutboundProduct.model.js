import { DataTypes } from "sequelize";

export function defineOutboundProduct(sequelize) {
  return sequelize.define(
    "OutboundProduct",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: { type: DataTypes.STRING, allowNull: false },
      tags: {
        type: DataTypes.ARRAY(DataTypes.STRING),
        allowNull: false,
        defaultValue: [],
      },
      defaultSalePrice: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: "outbound_products",
      indexes: [{ fields: ["name"] }],
    }
  );
}
