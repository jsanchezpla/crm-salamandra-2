import { DataTypes } from "sequelize";

/**
 * OutreachAnalysis — análisis IA de un lead para UNA línea de negocio.
 *
 * Un lead tiene tantos análisis como líneas de negocio activas tenga el tenant
 * (Salamandra: dos, Solutions y Agencia). El enum `empresa` del Outreach
 * original se sustituye por la FK `businessLineId`, que es lo que permite que
 * cada tenant defina sus propias líneas.
 *
 * El análisis se PERSISTE para no reanalizar: reanalizar cuesta tiempo y una
 * llamada de API. Solo se sobrescribe si el usuario pulsa "Re-analizar".
 *
 * `emailDraft` guarda el correo modelo que propone la IA. `sentAt` se rellena
 * únicamente cuando el envío se confirma, para no reenviar sin querer.
 * Nada se envía de forma automática: la IA propone, una persona confirma.
 */
export function defineOutreachAnalysis(sequelize) {
  return sequelize.define(
    "OutreachAnalysis",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      outreachLeadId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      businessLineId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      score: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 0, max: 100 },
      },
      // Por qué merece la pena llamarles, en una o dos frases.
      reasonWhy: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Carencias concretas que esta línea de negocio resuelve (array de strings).
      needs: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      pitch: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Correo modelo propuesto por la IA: { subject, body }. Editable antes de enviar.
      emailDraft: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      // Solo se rellena tras confirmar el envío. NULL = no enviado.
      sentAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      analyzedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // Modelo de IA que generó este análisis (trazabilidad de coste/calidad).
      model: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
    },
    {
      tableName: "outreach_analyses",
      indexes: [
        {
          unique: true,
          fields: ["outreach_lead_id", "business_line_id"],
          name: "outreach_analyses_lead_line_key",
        },
        { fields: ["score"], name: "outreach_analyses_score_idx" },
      ],
    }
  );
}
