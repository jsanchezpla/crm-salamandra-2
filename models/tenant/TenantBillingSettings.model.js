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
      defaultPaymentTermsDays: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 30,
      },
      // Régimen fiscal del emisor. Determina si se aplica IRPF por defecto:
      //   'company'   → SL / empresa: SIN retención de IRPF (0%).
      //   'freelance' → autónomo profesional: aplica `defaultIrpfRate` (típico 15%).
      // El usuario lo elige con un interruptor claro en Configuración → Facturación.
      taxRegime: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "company",
        validate: { isIn: [["company", "freelance"]] },
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
      invoiceFooterText: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      logoUrl: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      tableName: "tenant_billing_settings",
    }
  );
}
