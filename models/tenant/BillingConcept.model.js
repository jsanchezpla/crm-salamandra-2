/**
 * BillingConcept — el catálogo de conceptos y cuotas de facturación
 * (31/08/2026).
 *
 * Lo que Aumenta llamaba «cuotas» en el Organízate: un concepto con nombre
 * interno («Cuota Logopedia 60x2»), el texto que sale en la factura, su
 * importe (BASE imponible; el IVA va aparte en `vatRate` — con la exención
 * las dos cifras coinciden), la categoría para agrupar el desplegable y la
 * periodicidad orientativa («mensual»…). Elegirlo en una línea de factura
 * rellena texto, precio e IVA de una vez.
 */

import { DataTypes } from "sequelize";

export function defineBillingConcept(sequelize) {
  return sequelize.define(
    "BillingConcept",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      name: { type: DataTypes.STRING(120), allowNull: false },
      // El texto que sale impreso; vacío = se usa `name`.
      description: { type: DataTypes.TEXT, allowNull: true },
      unitPrice: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0, field: "unit_price" },
      vatRate: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 0, field: "vat_rate" },
      category: { type: DataTypes.STRING(80), allowNull: true },
      // Orientativa: «mensual», «trimestral»… (la cuota mensual real la lleva
      // el cobro con su period_month; esto solo rotula el catálogo).
      periodicity: { type: DataTypes.STRING(20), allowNull: true },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "sort_order" },
    },
    { tableName: "billing_concepts" }
  );
}
