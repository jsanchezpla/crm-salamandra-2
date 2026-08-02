import { DataTypes } from "sequelize";

/**
 * CashClose — arqueo: el cierre de caja de un día.
 *
 * Contar el dinero que hay en el cajón y compararlo con lo que el sistema dice
 * que debería haber. La diferencia entre las dos cifras es TODO el valor de este
 * registro: si no se guarda el descuadre, el arqueo no sirve para nada.
 *
 * ── Por qué tres importes y no uno ─────────────────────────────────────────
 *
 *   openingAmount  el fondo de caja con el que se empieza el día
 *   expectedAmount lo que DEBERÍA haber: fondo + cobros en efectivo del día.
 *                  Se calcula, no se teclea.
 *   countedAmount  lo que hay DE VERDAD al contarlo a mano
 *
 * `difference` se guarda calculado (contado − esperado) en vez de calcularse al
 * leer: el esperado depende de los cobros de ese día, y si mañana se corrige un
 * cobro antiguo, el arqueo de hace un mes cambiaría de resultado solo. Un cierre
 * es una FOTO de lo que se contó ese día; no puede reescribirse a posteriori.
 *
 * Negativo = falta dinero. Positivo = sobra.
 */
export function defineCashClose(sequelize) {
  return sequelize.define(
    "CashClose",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      cashPointId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      closeDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      openingAmount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      expectedAmount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      countedAmount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      // Foto del descuadre en el momento del cierre. Ver cabecera.
      difference: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      // Obligatorio en la UI cuando hay descuadre: un "faltan 20 €" sin
      // explicación no vale de nada dentro de seis meses.
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Quién lo cuadró. Es la pregunta que se hace siempre al revisar un
      // descuadre.
      closedById: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      closedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "cash_closes",
      indexes: [
        // NO es único (cambiado el 02/08/2026). Al principio se puso un único
        // por (caja, día) pensando que cerrar dos veces sería un error de uso.
        // Al importar Aumenta se vio que cierran VARIAS veces al día —cada
        // cierre con su hora— y Rodrigo confirmó que quiere seguir así: es lo
        // normal en un mostrador con varios turnos. La hora está en `closedAt`.
        { fields: ["cash_point_id", "close_date"], name: "cash_closes_point_date_idx" },
        { fields: ["close_date"], name: "cash_closes_date_idx" },
      ],
    }
  );
}
