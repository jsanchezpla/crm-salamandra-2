import { DataTypes } from "sequelize";

/**
 * AiPermission — solicitudes y concesiones de permiso para usar la IA de pago.
 *
 * Solo entra en juego cuando el tenant tiene settings.aiAccess = "restringido":
 * un empleado (rol no-admin) que dispara una acción de IA sin permiso genera
 * una fila `pendiente` y el admin decide en Configuración → IA:
 *
 *   status: pendiente → concedido | denegado   (y concedido → revocado)
 *   scope (solo al conceder): "general" (para siempre) | "una-vez"
 *   used_at: cuándo se consumió una concesión "una-vez" (una sola tirada)
 *
 * user_id y decided_by apuntan a master.users SIN FK (referencia lógica entre
 * schemas, mismo criterio que notifications.user_id).
 */
export function defineAiPermission(sequelize) {
  return sequelize.define(
    "AiPermission",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "pendiente",
        validate: { isIn: [["pendiente", "concedido", "denegado", "revocado"]] },
      },
      scope: {
        type: DataTypes.STRING(20),
        allowNull: true,
        validate: { isIn: [["general", "una-vez"]] },
      },
      // Qué intentaba hacer (etiqueta legible: "transcribir una sesión",
      // "análisis de lead"…) para que el admin decida con contexto.
      accion: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
      usedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      decidedBy: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      decidedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "ai_permissions",
      indexes: [{ fields: ["user_id", "status"] }],
    }
  );
}
