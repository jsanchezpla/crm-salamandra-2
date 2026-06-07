import { DataTypes } from "sequelize";

// Una Formula define cuánto de un InboundProduct entra en cada kg producido de un
// OutboundProduct. La receta puede ser global (clientId NULL) o específica de un
// cliente. Al aplicar la receta se busca primero la del cliente y, si no existe,
// se usa la global como fallback.
export function defineFormula(sequelize) {
  return sequelize.define(
    "Formula",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      outboundProductId: { type: DataTypes.UUID, allowNull: false },
      inboundProductId: { type: DataTypes.UUID, allowNull: false },
      qtyKgPerOutputKg: {
        type: DataTypes.DECIMAL(10, 4),
        allowNull: false,
        defaultValue: 1,
      },
      clientId: { type: DataTypes.UUID, allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: "formulas",
      indexes: [
        { fields: ["outbound_product_id"] },
        { fields: ["inbound_product_id"] },
        { fields: ["client_id"] },
        // El UNIQUE (outboundProductId, inboundProductId, clientId) vive en la
        // migración SQL con COALESCE sobre clientId, porque PG por defecto
        // permite múltiples NULL en columnas UNIQUE y queremos exactamente
        // UNA receta global (clientId NULL) por par (outbound, inbound).
      ],
    }
  );
}
