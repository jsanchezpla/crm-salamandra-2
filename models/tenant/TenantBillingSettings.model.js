import { DataTypes } from "sequelize";

/**
 * Configuración de facturación a nivel tenant.
 *
 * Una sola fila por tenant (creada al activar el módulo billing).
 * Contiene datos fiscales del emisor, tipos de IVA disponibles,
 * términos de pago por defecto, etc.
 */
export function defineTenantBillingSettings(sequelize) {
  return sequelize.define(
    "TenantBillingSettings",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      // ── Datos fiscales del emisor ───────────────────────────────────────
      fiscalName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      taxId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      fiscalAddress: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      fiscalCity: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      fiscalZip: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      fiscalCountry: {
        type: DataTypes.STRING(2),
        allowNull: false,
        defaultValue: "ES",
      },
      // ── Configuración fiscal ────────────────────────────────────────────
      defaultVatRate: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: false,
        defaultValue: 21,
      },
      // Lista personalizable de tipos de IVA disponibles. JSON array de DECIMAL.
      availableVatRates: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [21, 10, 4, 0],
      },
      // Exención GENERAL de IVA: para emisores que no repercuten IVA (p. ej.
      // sanidad/educación, art. 20 LIVA). Con esto activo, las nuevas facturas
      // nacen a IVA 0 y llevan `vatExemptNote` congelada en la propia factura
      // (para que el PDF muestre la nota legal aunque luego cambie la config).
      vatExempt: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      vatExemptNote: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: "Operación exenta de IVA conforme al artículo 20 de la Ley 37/1992 del IVA.",
      },
      defaultPaymentTermsDays: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 30,
      },
      // Régimen fiscal del emisor. Determina si se aplica IRPF por defecto:
      //   'company'   → SL / empresa: SIN retención de IRPF (0%).
      //   'autonomo'  → autónomo con actividad empresarial: SIN retención (0%).
      //   'freelance' → autónomo PROFESIONAL: aplica `defaultIrpfRate` (típico 15%).
      // El usuario lo elige con botones claros en Configuración → Facturación.
      // La columna es VARCHAR(20) sin CHECK en BD: añadir un valor aquí no
      // necesita migración.
      taxRegime: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "company",
        validate: { isIn: [["company", "autonomo", "freelance"]] },
      },
      // Retención IRPF por defecto aplicada a nuevas facturas (sobre base).
      // Por defecto 0: solo se aplica si el emisor es autónomo profesional
      // (taxRegime = 'freelance'), momento en el que la UI lo pone a 15.
      defaultIrpfRate: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: false,
        defaultValue: 0,
      },
      // Socios del negocio (mientras no seamos SL, cada uno factura/deduce
      // por separado). Cada factura y cada gasto se atribuye a un socio.
      partners: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [
          { id: "jorge", name: "Jorge" },
          { id: "rodrigo", name: "Rodrigo" },
        ],
      },
      // ── Branding documento ──────────────────────────────────────────────
      // El membrete es POR DOCUMENTO (31/08/2026): `logoUrl` +
      // `invoiceFooterText` visten la factura; el presupuesto tiene los suyos
      // y, si están vacíos, cae a los de la factura (lib/billing/membrete.js).
      invoiceFooterText: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      logoUrl: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      quoteFooterText: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "quote_footer_text",
      },
      quoteLogoUrl: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "quote_logo_url",
      },
      // El sello del centro: se pinta junto a los totales del PDF de factura
      // y se puede quitar por descarga (?sello=0). 31/08/2026.
      stampUrl: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "stamp_url",
      },
    },
    {
      tableName: "tenant_billing_settings",
    }
  );
}
