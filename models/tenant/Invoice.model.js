import { DataTypes } from "sequelize";

export function defineInvoice(sequelize) {
  return sequelize.define(
    "Invoice",
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
      // ── Campos de módulo de facturación ──────────────────────────────────
      familyId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      patientId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      therapistId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      serviceType: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      invoiceType: {
        type: DataTypes.ENUM("session", "pack", "subscription"),
        allowNull: true,
      },
      recurringConfig: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
      discountType: {
        type: DataTypes.ENUM("percent", "fixed"),
        allowNull: true,
      },
      discountValue: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
      },
      // ── Campos base ───────────────────────────────────────────────────────
      number: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      status: {
        type: DataTypes.ENUM("draft", "sent", "paid", "partial", "overdue", "cancelled"),
        allowNull: false,
        defaultValue: "draft",
      },
      issueDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      dueDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      paidAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      lines: {
        type: DataTypes.JSONB,
        defaultValue: [],
      },
      subtotal: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      vatRate: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: false,
        defaultValue: 0,
      },
      vatAmount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      total: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      pdfUrl: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // ── Verifactu / Facturantia ───────────────────────────────────────────
      facturantiaId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      qrUrl: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      verifactuStatus: {
        type: DataTypes.ENUM("pending", "sent", "accepted", "rejected"),
        allowNull: true,
      },
      verifactuSentAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      customFields: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
    },
    {
      tableName: "invoices",
    }
  );
}
