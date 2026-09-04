import { DataTypes } from "sequelize";

/**
 * OutreachLead — empresa captada de una fuente pública, todavía sin contactar.
 *
 * OJO: NO es el `Lead` del módulo comercial del CRM (oportunidad con etapas,
 * valor y conversión a proyecto). Son entidades independientes y sin puente,
 * por decisión de arquitectura. De ahí el prefijo `outreach_` en la tabla: sin
 * él, esta tabla chocaría con la tabla `leads` que ya existe en cada schema de
 * tenant.
 *
 * El índice único (name, location, source) es el que impide que "Buscar nuevos"
 * duplique empresas al re-scrapear la misma zona.
 */
export function defineOutreachLead(sequelize) {
  return sequelize.define(
    "OutreachLead",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      sector: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      location: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // TEXT y no STRING(255): el `websiteUri` de Google (y algún "sitio web" de
      // GMB que en realidad es una URL de reservas con parámetros) supera de
      // largo los 255 y reventaba el INSERT ("value too long for varchar(255)").
      website: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      phone: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      email: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // 'paginas_amarillas' | 'google_maps' | 'linkedin' | 'manual'.
      // STRING y no ENUM a propósito: añadir una fuente nueva no debe exigir
      // una migración de tipo en todos los tenants.
      source: {
        type: DataTypes.STRING(64),
        allowNull: false,
        defaultValue: "manual",
      },
      sourceUrl: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Todo lo crudo que devuelva el scraping (redes, horarios, reseñas...).
      // Es la materia prima del análisis IA.
      rawData: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      // true en cuanto existe al menos un análisis para este lead.
      analyzed: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Seguimiento manual del comercial: 'new' | 'contacted' | 'discarded'.
      // Lista canónica y etiquetas en lib/outreach/estados.js. STRING y no ENUM
      // por lo mismo que `source`: añadir un estado no debe migrar tipos.
      status: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: "new",
      },
      // Cuándo se puso el estado actual, para saber desde cuándo lleva un lead
      // contactado sin respuesta o descartado.
      statusAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // Conversión a cliente: cuando se convierte en Client, el lead se marca
      // (no se borra) para (a) desaparecer de la lista de captados y (b) que
      // "Buscar nuevos" no lo vuelva a insertar (ya es cliente). `clientId` es
      // referencia blanda al Client del mismo schema (sin FK: módulos aparte).
      converted: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      convertedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      clientId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
    },
    {
      tableName: "outreach_leads",
      indexes: [
        {
          unique: true,
          fields: ["name", "location", "source"],
          name: "outreach_leads_dedupe_key",
        },
        { fields: ["sector"], name: "outreach_leads_sector_idx" },
        { fields: ["analyzed"], name: "outreach_leads_analyzed_idx" },
        { fields: ["status"], name: "outreach_leads_status_idx" },
      ],
    }
  );
}
