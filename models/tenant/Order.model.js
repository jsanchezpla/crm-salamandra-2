import { DataTypes } from "sequelize";

// Pedido comercial. Cabecera con cliente + estado + totales calculados.
// Las líneas vivien en `OrderLine`. Cuando se "completa", el endpoint
// /api/orders/[id]/complete crea una Invoice en estado draft asociada
// (invoiceId apunta a esa factura).
//
// Estados:
//   - draft       borrador editable
//   - confirmed   confirmado por el cliente / pasa a producción
//   - preparing   en preparación
//   - shipped     enviado
//   - completed   completado (genera factura borrador asociada)
//   - cancelled   cancelado (no genera factura)
export function defineOrder(sequelize) {
  return sequelize.define(
    "Order",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      clientId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM(
          "draft",
          "confirmed",
          "preparing",
          "shipped",
          "completed",
          "cancelled"
        ),
        allowNull: false,
        defaultValue: "draft",
      },
      // Totales calculados desde las líneas + transporte. Se recalculan en
      // cada PATCH y en /complete.
      subtotal: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      transportAmount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      total: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      // Fechas operativas
      scheduledDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      deliveredAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // Asociación con factura generada al completar
      invoiceId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      customFields: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
    },
    {
      tableName: "orders",
      indexes: [
        { fields: ["client_id"] },
        { fields: ["status"] },
        { fields: ["invoice_id"] },
      ],
    }
  );
}
