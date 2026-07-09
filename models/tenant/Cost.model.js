import { DataTypes } from "sequelize";

export function defineCost(sequelize) {
  return sequelize.define(
    "Cost",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      // Tipo de gasto y categoría contable
      type: {
        type: DataTypes.ENUM("salary", "rent", "software", "material", "commission", "other"),
        allowNull: false,
      },
      // 'opex' añadido al enum en la migración (rework billing)
      category: {
        type: DataTypes.ENUM("fixed", "variable", "capex", "opex"),
        allowNull: false,
      },
      description: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      // ── Importes con IVA por coste ──────────────────────────────────────
      taxBase: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      vatRate: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: false,
        defaultValue: 21,
      },
      taxAmount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      total: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      vatDeductible: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      // ── Compatibilidad: campo legacy `amount` mantenido en BD ───────────
      // Sequelize NO lo expone aquí para evitar uso accidental en código nuevo.
      // Migración futura: eliminar la columna definitivamente.
      // ── Fechas ──────────────────────────────────────────────────────────
      // `incurredAt` es la fecha real del gasto.
      // `month` (YYYY-MM) sigue existiendo en BD por compatibilidad pero ya no
      // se expone en el modelo Sequelize. Eliminarla en sprint futuro.
      incurredAt: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      // ── Relaciones ──────────────────────────────────────────────────────
      employeeId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // Socio que se desgrava este gasto (Jorge / Rodrigo). Mientras no seamos
      // SL, cada socio deduce sus propios gastos. id de settings.partners.
      partnerId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      clientId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // Columna histórica. Apuntaba al viejo modelo InventoryProduct (retirado
      // con el rework de Inventario). Sin asociación Sequelize: se decidirá si
      // eliminar o re-apuntar a OutboundProduct en un sprint posterior.
      inventoryProductId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // FK durmiente a Project (Sprint 1 Proyectos). Sin uso desde la UI ni
      // desde la lógica de cálculo de rentabilidad; se activa en Sprint 4.
      projectId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      attachmentUrl: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      tableName: "costs",
    }
  );
}
