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
      // ── Campos legacy del dominio terapéutico (NO usar en código nuevo) ──
      // No se borran porque el modelo billing antiguo aún los referencia.
      // Sprint futuro: limpieza de familyId/patientId/serviceType/invoiceType.
      familyId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      patientId: {
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
      // ── Identificación ──────────────────────────────────────────────────
      employeeId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      series: {
        type: DataTypes.STRING(8),
        allowNull: false,
        defaultValue: "F",
      },
      number: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      // ── Estado y fechas ─────────────────────────────────────────────────
      status: {
        type: DataTypes.ENUM(
          "draft",
          "issued",
          "sent",
          "paid",
          "partially_paid",
          "overdue",
          "cancelled",
          "rectified"
        ),
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
      // ── Líneas (estructura nueva con IVA por línea) ─────────────────────
      // Cada línea: { description, quantity, unitPrice, discountPct, vatRate,
      //               lineBase, lineVat, lineTotal }
      lines: {
        type: DataTypes.JSONB,
        defaultValue: [],
      },
      // ── Totales calculados ──────────────────────────────────────────────
      taxBase: {
        type: DataTypes.DECIMAL(12, 2),
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
      // Cache de la suma de cobros completed asociados
      paidAmount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      // ── Compatibilidad con cálculo antiguo (no se usa en código nuevo) ──
      // subtotal y vatRate quedaban como una sola tasa por factura.
      // Mantenidos para no romper datos antiguos durante un tiempo.
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
      discountType: {
        type: DataTypes.ENUM("percent", "fixed"),
        allowNull: true,
      },
      discountValue: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
      },
      // ── Rectificativas ──────────────────────────────────────────────────
      rectifiesInvoiceId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      rectifiedByInvoiceId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // ── Otros ───────────────────────────────────────────────────────────
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      pdfUrl: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      recurringConfig: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
      // ── Verifactu / Facturantia (no se toca en este sprint) ─────────────
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
