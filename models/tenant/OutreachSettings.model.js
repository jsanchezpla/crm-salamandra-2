import { DataTypes } from "sequelize";

/**
 * OutreachSettings — ajustes del módulo Outreach para un tenant. Fila única.
 *
 * Vive en el schema del tenant (y no en master.tenant_modules) porque el
 * contexto de empresa y la regla de encadenamiento son textos largos que
 * alimentan el prompt, y porque así se editan desde el propio módulo sin
 * tocar la configuración global del tenant.
 *
 * `companyContext` y `chainingRule` sustituyen a lo que en Outreach estaba
 * escrito a fuego en el system prompt (el grupo Salamandra y su regla de
 * "Agencia y Solutions se encadenan"). Ahora son datos, no código.
 */
export function defineOutreachSettings(sequelize) {
  return sequelize.define(
    "OutreachSettings",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      // Modelo de Claude usado para analizar. Cambiarlo permite abaratar el
      // coste por análisis sin tocar código.
      aiModel: {
        type: DataTypes.STRING(64),
        allowNull: false,
        defaultValue: "claude-opus-4-8",
      },
      // Quién es la empresa que analiza. Encabeza el system prompt.
      companyContext: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Regla opcional que relaciona las líneas de negocio entre sí
      // (p.ej. "si puntúa alto en Agencia y puede invertir, sube Solutions").
      chainingRule: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // ── Contador mensual de peticiones a Google Places ──────────────────────
      // El tope y el aviso los gestiona el CRM (no la cuota de Google), para
      // poder cortar a 999/mes y avisar por email. Se resetea al cambiar de mes.
      googlePlacesUsageMonth: {
        type: DataTypes.STRING(7), // "YYYY-MM"
        allowNull: true,
      },
      googlePlacesUsageCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      // Mes en el que ya se envió el email de aviso, para no repetirlo.
      googlePlacesWarnedMonth: {
        type: DataTypes.STRING(7),
        allowNull: true,
      },
    },
    {
      tableName: "outreach_settings",
    }
  );
}
