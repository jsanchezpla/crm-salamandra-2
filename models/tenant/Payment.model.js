import { DataTypes } from "sequelize";

export function definePayment(sequelize) {
  return sequelize.define(
    "Payment",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      // Nullable desde el sprint Aumenta 2026-07-28: el flujo real es cobros
      // ANTES que facturas — se registra que la clienta ha pagado y Rosa
      // asocia la factura después. Un cobro sin factura exige clientId.
      invoiceId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // Clienta que paga. Con factura se rellena desde invoice.clientId
      // (backfill en la migración del sprint); sin factura es obligatorio.
      clientId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // Mes al que corresponde el cobro ('YYYY-MM-01'). Es la pieza del
      // bloqueo por impago del portal: los documentos del mes M solo se ven
      // si existe un cobro completado con periodMonth = M (o desbloqueo
      // manual en Client.portalUnlockedMonths). También alimenta Morosidad.
      periodMonth: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
      },
      paidAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      method: {
        type: DataTypes.ENUM("card", "transfer", "cash", "direct_debit"),
        allowNull: false,
      },
      // 'refunded' añadido al enum en la migración (rework billing)
      status: {
        type: DataTypes.ENUM("pending", "completed", "failed", "refunded"),
        allowNull: false,
        defaultValue: "completed",
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "payments",
      indexes: [
        { fields: ["client_id"], name: "payments_client_idx" },
        { fields: ["period_month"], name: "payments_period_idx" },
      ],
    }
  );
}
