import { DataTypes } from "sequelize";

/**
 * Un calendario de cliente que alguien de Salamandra mira desde el calendario
 * global (calendar.salamandrasolutions.com), 03/09/2026, Rodrigo: «poder
 * controlar todos mis calendarios desde un mismo macro calendario».
 *
 * ── POR QUÉ HACE FALTA UNA TABLA ────────────────────────────────────────────
 * Una cuenta de `master.users` es de UN tenant, y el calendario global tiene
 * que leer varios. Esta fila es la que dice «la cuenta X ve el calendario del
 * tenant Y», y es a la vez la AUTORIZACIÓN: sin fila no se lee ni se toca
 * nada. No se deduce de nada (ni del correo, ni del rol): se pone a mano, por
 * script o desde el back-office.
 *
 * `tenantUsuarioId` es CON QUÉ cuenta se entra en ese tenant al saltar desde
 * el global («editar en el tenant»). Puede ir vacío: entonces el calendario se
 * ve y se mueve desde el global, pero el botón de saltar no aparece, porque
 * no hay con quién abrir sesión allí.
 *
 * Sin FK a propósito, como el Buzón: dar de baja a un cliente no tiene por
 * qué fallar por una fila de aquí; `vinculosDe` ignora los tenants que ya no
 * existen o no están activos.
 */
export function defineCalendarioGlobalVinculo(sequelize) {
  return sequelize.define(
    "CalendarioGlobalVinculo",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      // Quién mira (master.users.id).
      usuarioId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      // Qué calendario (master.tenants.id).
      tenantId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      // Con qué cuenta se entra en ese tenant al saltar (master.users.id, del
      // tenant de arriba). NULL = solo ver y mover desde el global.
      tenantUsuarioId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // Color con el que se pinta ese calendario en el global. NULL = el de
      // la marca del tenant, y si no tiene, uno de la paleta por orden.
      color: {
        type: DataTypes.STRING(7),
        allowNull: true,
      },
      orden: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: "calendario_global_vinculos",
      indexes: [{ unique: true, fields: ["usuario_id", "tenant_id"] }],
    }
  );
}
