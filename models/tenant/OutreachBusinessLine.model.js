import { DataTypes } from "sequelize";

/**
 * OutreachBusinessLine — línea de negocio del tenant contra la que se puntúa
 * cada lead captado.
 *
 * Sustituye al enum fijo `empresa ∈ {solutions, agencia}` del proyecto Outreach
 * original: cada tenant define SUS propias líneas (Salamandra tendrá "Solutions"
 * y "Agencia"; otro cliente tendrá las suyas). Es la pieza que convierte
 * Outreach en un módulo vendible y no en una herramienta interna.
 *
 * `description`, `scoringUp` y `scoringDown` alimentan el prompt del análisis
 * IA (Fase 3): la IA aprende de aquí qué vende cada línea y qué señales suben
 * o bajan el score. Sin líneas definidas, el módulo no puede analizar.
 */
export function defineOutreachBusinessLine(sequelize) {
  return sequelize.define(
    "OutreachBusinessLine",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      // Identificador estable y legible (p.ej. "solutions"). Se usa en la UI y
      // en las claves del JSON que devuelve la IA.
      key: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
        validate: { is: /^[a-z0-9_]+$/ },
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      // Qué vende esta línea. Va literal al system prompt.
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Señales que SUBEN el score (array de strings).
      scoringUp: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      // Señales que BAJAN el score (array de strings).
      scoringDown: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      sortOrder: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      tableName: "outreach_business_lines",
      indexes: [{ fields: ["sort_order"], name: "outreach_business_lines_sort_idx" }],
    }
  );
}
