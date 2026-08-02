import { DataTypes } from "sequelize";

/**
 * CashPoint — punto de atención donde se cobra en efectivo.
 *
 * La recepción de un centro, el mostrador de una tienda. La mayoría de clientes
 * tendrá UNO solo, pero existe como entidad porque el arqueo se hace POR punto:
 * si hay dos cajas físicas, cada una se cuadra por su cuenta o el descuadre no
 * se puede atribuir a nadie.
 *
 * Sale de la revisión del 02/08/2026: el módulo de Facturación cubría casi todo
 * lo de Contabilidad de Organízate menos el arqueo, que allí son tres secciones
 * (`cajas`, `arqueo`, `cierres`).
 */
export function defineCashPoint(sequelize) {
  return sequelize.define(
    "CashPoint",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      // Se desactiva en vez de borrarse: sus cierres históricos siguen
      // apuntando aquí y borrarlo dejaría el histórico sin nombre.
      active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "cash_points",
      indexes: [{ fields: ["active"], name: "cash_points_active_idx" }],
    }
  );
}
