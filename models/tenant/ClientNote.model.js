import { DataTypes } from "sequelize";

/**
 * ClientNote — nota interna asociada a un cliente.
 *
 * Distinta de `Interaction` (historial de contactos con el cliente):
 *   - ClientNote.createdAt es timestamp automático (no editable).
 *   - Interaction.date es DATEONLY editable (cuándo ocurrió la llamada/reunión).
 *   - Una nota es privada (solo equipo interno), una interacción es un
 *     registro de algo ocurrido CON el cliente.
 *
 * No tiene atributo `type` — todas las notas son del mismo tipo (texto libre).
 * El orden visual es DESC por createdAt.
 */
export function defineClientNote(sequelize) {
  return sequelize.define(
    "ClientNote",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      clientId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      content: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      createdBy: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // Miembro del equipo que escribió la nota (2026-07-23). Enlace real,
      // frente a `createdBy` que es solo texto.
      teamMemberId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: "team_member_id",
      },
    },
    {
      tableName: "client_notes",
      indexes: [
        { fields: ["client_id"], name: "client_notes_client_id_idx" },
        { fields: ["created_at"], name: "client_notes_created_at_idx" },
      ],
    }
  );
}
