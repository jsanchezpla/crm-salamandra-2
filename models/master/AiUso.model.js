import { DataTypes } from "sequelize";

/**
 * master.ai_uso — una fila por llamada de pago a la IA (11/09/2026).
 *
 * Quién la escribe: `lib/ai/usoDeIA.js`, desde el cliente central de Anthropic
 * y desde Whisper. Quién la lee: Configuración → IA (consumo estimado del mes)
 * y quien quiera saber en qué se va el saldo de un cliente.
 *
 * Va en master y no en el schema del tenant por lo mismo que `audit_logs`: es
 * contabilidad transversal, se consulta por tenant desde el panel de
 * plataforma y no lleva datos personales. Sin FK a propósito, como el Buzón:
 * la baja de un cliente no tiene que tropezar con su historial de gasto.
 *
 * `costeUsd` es una ESTIMACIÓN con los precios públicos del momento
 * (`lib/ai/precios.js`); la factura de verdad la tiene la consola del
 * proveedor. `cacheado` = se devolvió una respuesta anterior sin llamar a
 * nadie (`lib/ai/cacheDeRespuestas.js`): cuenta como llamada, cuesta 0.
 */
export function defineAiUso(sequelize) {
  return sequelize.define(
    "AiUso",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: true },
      userId: { type: DataTypes.UUID, allowNull: true },
      /** "anthropic" | "openai" */
      proveedor: { type: DataTypes.STRING(20), allowNull: false },
      modelo: { type: DataTypes.STRING(80), allowNull: true },
      /** La etiqueta legible de `vetoAi` («transcribir una sesión clínica»). */
      accion: { type: DataTypes.STRING(200), allowNull: true },
      inputTokens: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      cacheWriteTokens: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      cacheReadTokens: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      outputTokens: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      /** Whisper: cuánto audio se transcribió. */
      segundosAudio: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      costeUsd: { type: DataTypes.DECIMAL(10, 6), allowNull: true },
      ms: { type: DataTypes.INTEGER, allowNull: true },
      /** `stop_reason` de Anthropic: end_turn, max_tokens… */
      parada: { type: DataTypes.STRING(40), allowNull: true },
      cacheado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      tableName: "ai_uso",
      updatedAt: false,
    }
  );
}
