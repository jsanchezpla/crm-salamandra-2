import { DataTypes } from "sequelize";

/**
 * StockEntry — una recepción de mercancía. Lo que llega del proveedor.
 *
 * Sustituye a `InboundBatch` (rework de Inventario, 02/08/2026).
 *
 * ── Los tres cambios respecto a lo viejo ───────────────────────────────────
 *
 * 1. **`quantity`, no `kg`.** La cantidad va en la unidad del producto, que la
 *    define `Product.unit`. Antes solo se podían recibir kilos.
 *
 * 2. **`supplierId`, no texto libre.** `InboundBatch.supplier` era un STRING
 *    obligatorio, así que «Novozymes», «NOVOZYMES» y «Novozymes S.L.» eran tres
 *    proveedores distintos. Ahora es un desplegable contra `Supplier`.
 *
 * 3. **`costId` enlaza con el gasto que la pagó.** Es lo que faltaba para cerrar
 *    el círculo con Facturación: desde un gasto se puede ver qué entregas cubre,
 *    y desde una entrega, con qué factura se pagó. Nullable, porque muchas veces
 *    la mercancía llega antes que la factura.
 *
 * ── `lot` y `expiryDate` son campos, no un modelo aparte ───────────────────
 *
 * Un centro clínico necesita caducidades (tests, material estéril) y una librería
 * no las usará jamás. Como campos opcionales no estorban a nadie; como modelo
 * separado obligarían a todo el mundo a entender un concepto que no usan.
 *
 * NO se guarda «cuánto queda» de la entrada: el stock se calcula sumando
 * movimientos (ver StockMovement). Una columna de saldo se desincroniza.
 */
export function defineStockEntry(sequelize) {
  return sequelize.define(
    "StockEntry",
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
      // Nullable: se puede registrar una entrada sin saber aún el proveedor
      // (una donación, material que aparece en un traslado). Obligarlo llevaría
      // a inventar fichas de proveedor para poder dar de alta el stock.
      supplierId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      entryDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      // En la unidad del producto.
      quantity: {
        type: DataTypes.DECIMAL(12, 3),
        allowNull: false,
      },
      // Coste POR UNIDAD, no total: es lo que se compara entre proveedores.
      unitCost: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
      },
      lot: {
        type: DataTypes.STRING(80),
        allowNull: true,
      },
      expiryDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      // El gasto que pagó esta entrega. Ver cabecera.
      costId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "stock_entries",
      indexes: [
        { fields: ["product_id"], name: "stock_entries_product_idx" },
        { fields: ["supplier_id"], name: "stock_entries_supplier_idx" },
        { fields: ["entry_date"], name: "stock_entries_date_idx" },
        { fields: ["cost_id"], name: "stock_entries_cost_idx" },
        // Para el aviso de caducidad próxima.
        { fields: ["expiry_date"], name: "stock_entries_expiry_idx" },
      ],
    }
  );
}
