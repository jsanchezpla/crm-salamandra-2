import { DataTypes } from "sequelize";

/**
 * Supplier — proveedor del centro. A quien SE LE COMPRA.
 *
 * POR QUÉ EXISTE (Rodrigo, 02/08/2026): hasta ahora los proveedores estaban en
 * dos sitios y ninguno servía.
 *
 *   · En Gastos no existían: `Cost` tiene tipo y categoría, pero no proveedor.
 *     No se podía responder «cuánto llevamos gastado con este proveedor».
 *   · En Inventario sí, pero como **texto libre y obligatorio**
 *     (`InboundBatch.supplier`). El mismo proveedor se reescribía en cada
 *     entrega, así que «Novozymes», «NOVOZYMES» y «Novozymes S.L.» eran tres
 *     proveedores distintos para el sistema.
 *
 * Es una entidad COMPARTIDA a propósito, porque un proveedor hace las dos cosas:
 * te factura (gasto) y te entrega mercancía (entrada de stock).
 *
 *     Supplier ←── Cost.supplierId        (lo que le pagas)
 *              ←── StockEntry.supplierId  (lo que te entrega)
 *
 * ── Qué NO es ──────────────────────────────────────────────────────────────
 *
 * NO va dentro de Pedidos. `Order` es una VENTA: cliente, productos de salida y
 * factura emitida — dinero que ENTRA. Un proveedor es dinero que SALE.
 * Mezclarlos rompería cualquier informe de márgenes.
 */
export function defineSupplier(sequelize) {
  return sequelize.define(
    "Supplier",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      // Lo único obligatorio: un proveedor sin nombre no sirve de nada.
      name: {
        type: DataTypes.STRING(200),
        allowNull: false,
      },
      taxId: {
        type: DataTypes.STRING(30),
        allowNull: true,
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      phone: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      // Persona de contacto en el proveedor (comercial, administración…).
      contactName: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
      address: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Se desactiva en vez de borrarse: sus gastos y entregas históricos siguen
      // apuntando aquí, y borrarlo dejaría el histórico sin nombre.
      active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      tableName: "suppliers",
      indexes: [
        { fields: ["name"], name: "suppliers_name_idx" },
        { fields: ["active"], name: "suppliers_active_idx" },
      ],
    }
  );
}
