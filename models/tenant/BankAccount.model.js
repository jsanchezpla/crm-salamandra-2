import { DataTypes } from "sequelize";

/**
 * BankAccount — una cuenta bancaria REAL del tenant, conectada por PSD2
 * (GoCardless Bank Account Data). Módulo `banco`, 29/08/2026.
 *
 * Cada fila nace al terminar el consentimiento en la web del banco: la
 * requisición de GoCardless devuelve una o varias cuentas y aquí se guarda lo
 * justo para poder pedir sus movimientos y enseñar de quién son.
 *
 * `accountUid` es el id del RECURSO cuenta en GoCardless (estable entre
 * reconexiones de la misma cuenta) y es UNIQUE: reconectar el mismo banco
 * actualiza la fila en vez de duplicarla.
 *
 * `status` es texto y no ENUM a propósito (como en Soporte): los estados los
 * dicta un proveedor externo y un valor nuevo no puede exigir una migración.
 * Hoy se escriben tres: "linked" (funciona), "expired" (el consentimiento PSD2
 * caducó: hay que reconectar) y "suspended" (el banco la cortó).
 */
export function defineBankAccount(sequelize) {
  return sequelize.define(
    "BankAccount",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      // La requisición de GoCardless de la que salió esta cuenta. Sirve para
      // reconectar y para depurar contra su panel.
      requisitionId: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      institutionId: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      institutionName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      accountUid: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      iban: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // Cómo llama el banco a la cuenta ("CUENTA NÓMINA", el titular…).
      name: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      currency: {
        type: DataTypes.STRING(3),
        allowNull: true,
      },
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "linked",
      },
      // Cuándo caduca el consentimiento PSD2 (lo normal, 90 días). Se calcula
      // con los datos del ACUERDO de GoCardless (aceptado + días concedidos),
      // nunca inventado aquí. Al caducar hay que volver a pasar por el banco.
      agreementExpiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      lastSyncedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // El último error de sincronización, para poder enseñarlo en pantalla en
      // vez de fallar en silencio. Se limpia al sincronizar bien.
      lastSyncError: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "bank_accounts",
    }
  );
}
