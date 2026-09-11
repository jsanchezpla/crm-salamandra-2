import { DataTypes } from "sequelize";

/**
 * Serie de facturación. Cada tenant tiene al menos:
 *   - 'F' (factura ordinaria)
 *   - 'R' (rectificativa)
 * El contador `nextNumber` se incrementa con SELECT FOR UPDATE en una
 * transacción explícita al emitir cada factura, garantizando unicidad
 * y correlatividad sin huecos (obligatorio fiscalmente).
 */
export function defineInvoiceSeries(sequelize) {
  return sequelize.define(
    "InvoiceSeries",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      code: {
        type: DataTypes.STRING(8),
        allowNull: false,
        unique: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      // Prefijo aplicado al número final. Por defecto coincide con `code`
      // pero permite formatos tipo "FAC", "REC", etc.
      prefix: {
        type: DataTypes.STRING(16),
        allowNull: false,
      },
      // Año al que pertenece la numeración. Si cambia, se reinicia el contador.
      year: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      // Próximo número a asignar. Se actualiza con FOR UPDATE.
      nextNumber: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      isDefault: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // 'normal' = facturación ordinaria; 'rectificative' = rectificativas
      kind: {
        type: DataTypes.ENUM("normal", "rectificative"),
        allowNull: false,
        defaultValue: "normal",
      },
      /*
       * CÓMO SE ESCRIBE EL NÚMERO (12/09/2026). Fichas `{prefix}`, `{year}`,
       * `{yy}` y `{n}`/`{n:5}` (lib/billing/formatoDeSerie.js). NULL = el
       * formato de siempre, `{prefix}-{year}-{n:4}`. Existe para seguir la
       * numeración de otro programa en vez de abrir otra serie: Aumenta
       * continúa la de Organízate (`C2602246`, rectificativas `R-C2600029`).
       */
      numberFormat: {
        type: DataTypes.STRING(40),
        allowNull: true,
      },
    },
    {
      tableName: "invoice_series",
    }
  );
}
