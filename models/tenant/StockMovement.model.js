import { DataTypes } from "sequelize";

/**
 * StockMovement — el libro mayor del almacén. TODA variación pasa por aquí.
 *
 * Rehecho el 02/08/2026 con el resto de Inventario. Antes colgaba de un lote
 * (`inboundBatchId`) y medía en `kg`; ahora cuelga del producto y la cantidad va
 * en la unidad de ese producto.
 *
 * ── El stock es la SUMA de los movimientos ─────────────────────────────────
 *
 * No hay ninguna columna «stock actual» en `Product`, y es deliberado. Una
 * columna denormalizada se desincroniza en cuanto algo falla a medias, y a
 * partir de ahí nadie sabe cuál de los dos números es la verdad. Sumar es
 * barato: son unos pocos miles de filas por tenant y va indexado por producto.
 *
 *     stock(producto) = SUM(quantity WHERE product_id = ...)
 *
 * `quantity` positiva = entra. Negativa = sale. Un ajuste puede ser de los dos
 * signos.
 *
 * ── Por qué `type` y `reason` separados ────────────────────────────────────
 *
 * `type` es el QUÉ (lo usa el código para agrupar y para saber qué mirar);
 * `reason` es el POR QUÉ en palabras, y en los ajustes manuales es OBLIGATORIO
 * en la UI: un «faltan 12» sin explicación no vale de nada dentro de seis meses.
 */
export function defineStockMovement(sequelize) {
  return sequelize.define(
    "StockMovement",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      productId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      // + entra · − sale. Ver cabecera.
      quantity: {
        type: DataTypes.DECIMAL(12, 3),
        allowNull: false,
      },
      type: {
        type: DataTypes.ENUM("entrada", "salida", "ajuste", "pedido"),
        allowNull: false,
        defaultValue: "ajuste",
      },
      reason: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      // De dónde viene el movimiento. Nunca los dos a la vez.
      entryId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      orderId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // Quién lo hizo. Es la primera pregunta al revisar un descuadre de stock.
      teamMemberId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      movedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "stock_movements",
      indexes: [
        { fields: ["product_id"], name: "stock_movements_product_idx" },
        { fields: ["moved_at"], name: "stock_movements_date_idx" },
        { fields: ["order_id"], name: "stock_movements_order_idx" },
        { fields: ["entry_id"], name: "stock_movements_entry_idx" },
      ],
    }
  );
}
