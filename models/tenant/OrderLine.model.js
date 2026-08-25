import { DataTypes } from "sequelize";

// Línea de un pedido. `productId` es referencia opcional al catálogo del
// almacén (`Product`). `productName` y `unitPrice` son FOTO del momento en que
// se creó la línea: sobreviven a que el producto se renombre, cambie de precio
// o se retire, para que un pedido de hace un año no cambie de importe solo.
//
// Renombrado el 02/08/2026 (era `outboundProductId`) con el rework de
// Inventario: el catálogo de productos «de salida» se fusionó en `Product`.
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
      productId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // La variante vendida y su nombre COPIADO (25/08/2026), igual que ya se
      // copia el del producto: la línea de un pedido de hace dos años tiene que
      // seguir diciendo «Talla M» aunque esa talla se haya borrado.
      variantId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: "variant_id",
      },
      variantName: {
        type: DataTypes.STRING(120),
        allowNull: true,
        field: "variant_name",
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
        { fields: ["product_id"] },
      ],
    }
  );
}
