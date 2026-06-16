import { DataTypes } from "sequelize";

/**
 * ClientAttachment — archivo PDF adjunto a un cliente.
 *
 * Storage físico vive bajo `uploads/{tenantSlug}/clients/{clientId}/{storedFilename}`
 * (volumen Docker). La columna `storedFilename` es un UUID + .pdf que no
 * contiene metadatos del original (para evitar path traversal o leaks).
 * `originalName` se conserva para mostrarlo al usuario y para el
 * Content-Disposition al descargar.
 *
 * Restricciones aplicadas en endpoint:
 *   - mimeType === "application/pdf"
 *   - fileSize ≤ 10 MB
 *   - máximo 50 archivos por cliente
 */
export function defineClientAttachment(sequelize) {
  return sequelize.define(
    "ClientAttachment",
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
      originalName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      storedFilename: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      mimeType: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      fileSize: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 0 },
      },
      uploadedBy: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      tableName: "client_attachments",
      indexes: [
        { fields: ["client_id"], name: "client_attachments_client_id_idx" },
        { fields: ["created_at"], name: "client_attachments_created_at_idx" },
      ],
    }
  );
}
