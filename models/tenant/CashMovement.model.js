import { DataTypes } from "sequelize";

/**
 * CashMovement — una entrada o una salida de dinero del cajón que NO es un
 * cobro (01/09/2026, petición de Aumenta).
 *
 * ── Por qué hace falta, si ya están los cobros ─────────────────────────────
 * El arqueo comparaba lo contado contra «fondo inicial + cobros en efectivo del
 * día». Por el cajón pasa mucho más: se paga la mensajería, se compra papel, se
 * saca el sobre para el banco, se mete cambio. Todo eso descuadraba el arqueo
 * sin que nadie pudiera explicar por qué, y el descuadre acababa en la casilla
 * de «motivo» — texto libre que dentro de seis meses no dice nada.
 *
 * Con esta tabla, lo esperado pasa a ser fondo + cobros en efectivo + entradas
 * − salidas, y cada movimiento tiene su fecha, su importe, su concepto y sus
 * observaciones: exactamente los cuatro datos que pidió el centro.
 *
 * `amount` es SIEMPRE positivo: el signo lo pone `direction`. Guardar salidas
 * en negativo parece más cómodo hasta que alguien suma la columna sin mirar.
 */
export function defineCashMovement(sequelize) {
  return sequelize.define(
    "CashMovement",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      // De qué cajón sale o entra. El arqueo se cuadra POR caja.
      cashPointId: { type: DataTypes.UUID, allowNull: false, field: "cash_point_id" },
      // El día al que se imputa (no la hora: un movimiento de caja es del día).
      date: { type: DataTypes.DATEONLY, allowNull: false },
      direction: { type: DataTypes.ENUM("in", "out"), allowNull: false },
      // Siempre positivo. Ver cabecera.
      amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      // Qué fue. Obligatorio: un apunte sin concepto no sirve para cuadrar nada.
      concept: { type: DataTypes.STRING(200), allowNull: false },
      notes: { type: DataTypes.TEXT, allowNull: true },
      // Quién lo apuntó, la primera pregunta al revisar un descuadre.
      createdById: { type: DataTypes.UUID, allowNull: true, field: "created_by_id" },
    },
    {
      tableName: "cash_movements",
      indexes: [
        { fields: ["cash_point_id", "date"], name: "cash_movements_point_date_idx" },
        { fields: ["date"], name: "cash_movements_date_idx" },
      ],
    }
  );
}
