import { DataTypes } from "sequelize";

/**
 * Quote — Presupuesto / Oferta comercial.
 *
 * Documento PRE-venta, NO fiscal: no lleva Verifactu ni numeración
 * correlativa obligatoria (a diferencia de Invoice). Vertebra la nueva
 * pantalla "Operativa" del módulo de facturación: pipeline comercial
 * (draft → sent → viewed → accepted) y conversión a factura en 1 clic.
 *
 * Se numera al CREAR (serie "P", P-YYYY-NNNN), no al emitir, porque al no
 * ser fiscal se permiten huecos. La traza a la factura resultante vive en
 * `convertedInvoiceId`; en la factura, el origen se guarda en
 * customFields.sourceQuoteId/Number (sin tocar la tabla invoices).
 */
export function defineQuote(sequelize) {
  return sequelize.define(
    "Quote",
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
      // FK a Proyecto (opcional) para rentabilidad presupuestado vs facturado.
      projectId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      employeeId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      series: {
        type: DataTypes.STRING(8),
        allowNull: false,
        defaultValue: "P",
      },
      number: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      status: {
        type: DataTypes.ENUM(
          "draft", // borrador
          "sent", // enviado al cliente
          "viewed", // visto por el cliente
          "accepted", // aceptado
          "rejected", // rechazado
          "expired", // caducado (pasó validUntil)
          "converted" // convertido en factura
        ),
        allowNull: false,
        defaultValue: "draft",
      },
      issueDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      // Fecha de validez de la oferta.
      validUntil: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      // Líneas con IVA por línea, misma forma que Invoice:
      // { description, quantity, unitPrice, discountPct, vatRate,
      //   lineBase, lineVat, lineTotal }
      lines: {
        type: DataTypes.JSONB,
        defaultValue: [],
      },
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
      // ── Ciclo de vida (timeline) ────────────────────────────────────────
      sentAt: { type: DataTypes.DATE, allowNull: true },
      viewedAt: { type: DataTypes.DATE, allowNull: true },
      acceptedAt: { type: DataTypes.DATE, allowNull: true },
      rejectedAt: { type: DataTypes.DATE, allowNull: true },
      // ── Conversión a factura ────────────────────────────────────────────
      convertedInvoiceId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      convertedAt: {
        type: DataTypes.DATE,
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
      tableName: "quotes",
    }
  );
}
