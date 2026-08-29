import { DataTypes } from "sequelize";

/**
 * BankTransaction — un movimiento REAL de la cuenta del banco (módulo `banco`,
 * 29/08/2026). Los trae la sincronización con GoCardless y son SOLO LECTURA:
 * el CRM no inventa, edita ni borra movimientos del banco.
 *
 * El importe va FIRMADO y en euros con dos decimales (DECIMAL, como Payment y
 * Cost, que es con quien se compara): positivo = entra dinero (se casa con un
 * COBRO), negativo = sale (se casa con un GASTO).
 *
 * La conciliación NO vive aquí: el enlace lo llevan `payments.bank_transaction_id`
 * y `costs.bank_transaction_id`, que es donde el botón «ver el movimiento» lo
 * necesita. Un movimiento sabe si está casado buscándose ahí.
 *
 * `transactionUid` es el identificador que da el banco vía GoCardless
 * (`internalTransactionId`, con `transactionId` de respaldo) y es único POR
 * CUENTA: sincronizar dos veces no duplica movimientos. Solo se guardan los
 * CONTABILIZADOS (`booked`): los pendientes aún no tienen id estable y
 * duplicarían al consolidarse.
 */
export function defineBankTransaction(sequelize) {
  return sequelize.define(
    "BankTransaction",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      bankAccountId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      transactionUid: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      bookingDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      valueDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
      },
      currency: {
        type: DataTypes.STRING(3),
        allowNull: false,
        defaultValue: "EUR",
      },
      // El concepto tal y como lo escribe el banco (remittance information).
      concept: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Quién está al otro lado: el ordenante si entra dinero, el beneficiario
      // si sale. Es la pista principal para sugerir con qué cobro casa.
      counterparty: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // La transacción entera tal y como llegó de GoCardless, por si mañana
      // hace falta un campo que hoy no se guarda suelto.
      raw: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
    },
    {
      tableName: "bank_transactions",
      indexes: [
        {
          fields: ["bank_account_id", "transaction_uid"],
          unique: true,
          name: "bank_tx_account_uid_unique",
        },
        { fields: ["booking_date"], name: "bank_tx_booking_date_idx" },
      ],
    }
  );
}
