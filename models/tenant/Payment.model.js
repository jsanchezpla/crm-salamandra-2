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
      // ── De quién y de qué terapia es la cuota (31/08/2026) ──────────────
      // «Facturar el mes» solo sabía agrupar por pagador porque el cobro no
      // guardaba ni el paciente ni el concepto. Ambos opcionales: el cobro a
      // mano de siempre sigue naciendo con los dos a NULL. `conceptId` apunta
      // al catálogo (billing_concepts) y solo se rellena cuando la cuota es de
      // UN concepto — una cuota compuesta no se puede partir por terapia.
      patientId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      conceptId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // De que CUOTA asignada nacio este cobro (01/09/2026, billing_cuotas).
      // Lo rellena solo la generacion mensual; el cobro apuntado a mano sigue
      // naciendo a NULL. Es lo que evita generar dos veces el mismo mes: sin
      // esta columna, "ya generado" habria que adivinarlo por importe y fecha.
      cuotaId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // ── El puente con el dinero de verdad (29/08/2026) ──────────────────
      // Hasta hoy un cobro era una anotación a mano: importe, fecha, método y
      // notas. No había NINGÚN identificador externo, así que desde un cobro no
      // se podía llegar ni al pago de Stripe ni al movimiento del banco. Estas
      // tres columnas son ese puente, y las tres son opcionales: el cobro
      // apuntado a mano de siempre sigue naciendo igual, con las tres a NULL.
      //
      // De qué sesión de pago online nació este cobro (payment_sessions). La
      // escribe SOLO el webhook de Stripe (lib/billing/cobroDesdeStripe.js) y
      // es única: una sesión pagada = un cobro, aunque Stripe reintente el
      // webhook tres días.
      paymentSessionId: {
        type: DataTypes.UUID,
        allowNull: true,
        unique: true,
      },
      // El PaymentIntent de Stripe: con él, el botón «Ver en Stripe» lleva a la
      // página de ese cobro en el panel (dashboard.stripe.com/payments/pi_…).
      stripePaymentIntentId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // El movimiento del banco con el que se concilió (bank_transactions, del
      // submódulo `billing_banco`). Sin FK a propósito: la tabla del banco existe en todos
      // los schemas, pero el enlace lo escribe solo quien tiene el módulo.
      bankTransactionId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
    },
    {
      tableName: "payments",
      indexes: [
        { fields: ["client_id"], name: "payments_client_idx" },
        { fields: ["period_month"], name: "payments_period_idx" },
        { fields: ["bank_transaction_id"], name: "payments_bank_tx_idx" },
      ],
    }
  );
}
