import { DataTypes } from "sequelize";
import { contextoDeUso } from "../../lib/ai/usoDeIA.js";
import { marcarAutoria } from "../../lib/auth/sesionCorta.js";

/**
 * La autoría de la sesión «como admin» del calendario global (12/09/2026).
 *
 * En esa sesión un admin de Salamandra trabaja con la cuenta admin del cliente,
 * y cada fila de auditoría sale con el `userId` de esa cuenta. Para que la fila
 * guarde además quién fue de verdad, `withTenant` deja en el contexto de la
 * petición el `impersonadorId` (tras verificar el token) y aquí se añade a
 * `after` como `comoAdminDesde`.
 *
 * Por qué en el modelo y no en `auditar()`: hay tres puertas que escriben en
 * audit_logs —`auditar`, `auditarLogin` y los `AuditLog.create` sueltos de
 * decenas de rutas—, y un hook las recoge todas sin tocarlas ni tener que
 * acordarse en la ruta siguiente. Fuera de una petición (scripts, timers) no
 * hay contexto y la fila se guarda tal cual. Importar usoDeIA no arrastra la
 * base de datos: su único import fijo es `precios.js`, que no importa nada.
 */
function firmarSesionComoAdmin(fila) {
  try {
    const impersonadorId = contextoDeUso()?.impersonadorId;
    if (!impersonadorId) return;
    const after = fila.get("after");
    const marcado = marcarAutoria(after, impersonadorId);
    if (marcado !== after) fila.set("after", marcado);
  } catch {
    // La auditoría es best-effort: firmar la autoría nunca tumba la fila.
  }
}

export function defineAuditLog(sequelize) {
  return sequelize.define(
    "AuditLog",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      tenantId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      action: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      entity: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      entityId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      before: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      after: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      ip: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      tableName: "audit_logs",
      updatedAt: false,
      hooks: {
        beforeCreate: (fila) => firmarSesionComoAdmin(fila),
        // Hoy nadie usa bulkCreate en audit_logs; así el día que alguien lo
        // haga, la autoría no se pierde en silencio.
        beforeBulkCreate: (filas) => {
          for (const fila of filas) firmarSesionComoAdmin(fila);
        },
      },
    }
  );
}
