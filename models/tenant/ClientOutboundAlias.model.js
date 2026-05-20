import { DataTypes } from "sequelize";

// Permite que un mismo OutboundProduct se venda a un cliente concreto bajo otro
// nombre comercial y, opcionalmente, con un precio distinto del defaultSalePrice.
export function defineClientOutboundAlias(sequelize) {
  return sequelize.define(
    "ClientOutboundAlias",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      outboundProductId: { type: DataTypes.UUID, allowNull: false },
      clientId: { type: DataTypes.UUID, allowNull: false },
      aliasName: { type: DataTypes.STRING, allowNull: false },
      customSalePrice: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    },
    {
      tableName: "client_outbound_aliases",
      indexes: [
        { fields: ["outboundProductId"] },
        { fields: ["clientId"] },
        {
          unique: true,
          fields: ["outboundProductId", "clientId"],
          name: "client_outbound_aliases_product_client_unique",
        },
      ],
    }
  );
}
