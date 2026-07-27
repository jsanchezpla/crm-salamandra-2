import { DataTypes } from "sequelize";

/**
 * Ajustes del módulo Soporte del tenant. UNA fila por schema (findOrCreate).
 *
 * `slaConfig` (JSONB) por prioridad, en HORAS:
 *   { critical: { firstResponseHours: 2, resolutionHours: 8 }, high: {...}, ... }
 * Lo que falte cae a los defaults de lib/support/sla.js.
 *
 * `autoClassify`: si el tenant lo ACTIVA (y tiene clave de IA configurada), los
 * tickets que entran por el portal se clasifican solos (prioridad + categoría).
 * Default false — la regla del CRM es que nada de IA se dispara solo; esto es
 * el tenant optando explícitamente por lo contrario para su bandeja.
 */
export function defineSupportSettings(sequelize) {
  return sequelize.define(
    "SupportSettings",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      slaEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      slaConfig: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      portalEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      portalIntro: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Emails internos que reciben aviso de ticket nuevo del portal.
      notifyEmails: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      autoClassify: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      tableName: "support_settings",
    }
  );
}
