import { DataTypes } from "sequelize";

export function defineInboundProduct(sequelize) {
  return sequelize.define(
    "InboundProduct",
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
      notes: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: "inbound_products",
      indexes: [{ fields: ["name"] }],
    }
  );
}
