import { DataTypes } from "sequelize";

/**
 * OutreachContact — persona dentro de una empresa captada.
 *
 * Distinto del `Contact` del módulo Clientes: aquí el contacto cuelga de un
 * lead de prospección, no de un cliente. `isDecisionMaker` es el campo más
 * útil para el comercial: permite ordenar por quién manda de verdad.
 */
export function defineOutreachContact(sequelize) {
  return sequelize.define(
    "OutreachContact",
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
      name: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // Puesto: gerente, director de marketing, propietario...
      role: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      phone: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      mobile: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      email: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      linkedin: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      isDecisionMaker: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "outreach_contacts",
      indexes: [{ fields: ["outreach_lead_id"], name: "outreach_contacts_lead_idx" }],
    }
  );
}
