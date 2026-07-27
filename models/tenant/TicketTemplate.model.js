import { DataTypes } from "sequelize";

/**
 * Plantilla de respuesta (macro) para las preguntas repetidas. El composer del
 * ticket la inserta en el cuadro de texto; el agente la retoca antes de enviar.
 */
export function defineTicketTemplate(sequelize) {
  return sequelize.define(
    "TicketTemplate",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      body: {
        type: DataTypes.TEXT,
        allowNull: false,
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
      tableName: "ticket_templates",
    }
  );
}
