import { DataTypes } from "sequelize";

/**
 * Document — archivo del módulo Documents. Solo metadatos en BD; los bytes
 * viven en el volumen local (ver `lib/documents/documentStorage.js`).
 *
 * `storagePath` es el path RELATIVO a UPLOADS_ROOT
 *   documents/{tenantSlug}/{ownerUserId | shared}/{documentUUID}.{ext}
 * `fileSize` son bytes REALES medidos en servidor al subir (nunca `file.size`
 * del cliente). MIME restringido por enum a PDF/DOCX/XLSX.
 *
 * Visibilidad heredada de la carpeta al crear (o elegida en la raíz). private =
 * solo el owner; shared = todos los usuarios del tenant leen, solo el owner borra.
 */
export function defineDocument(sequelize) {
  return sequelize.define(
    "Document",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      // NULL = documento en la raíz (sin carpeta).
      folderId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: "folder_id",
      },
      visibility: {
        type: DataTypes.ENUM("private", "shared"),
        allowNull: false,
      },
      ownerUserId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: "owner_user_id",
      },
      // Nombre original visible (saneado: sin control chars ni separadores).
      fileName: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: "file_name",
      },
      storagePath: {
        type: DataTypes.STRING(500),
        allowNull: false,
        field: "storage_path",
      },
      // BIGINT: bytes reales medidos server-side. Se serializa como Number
      // (valores << Number.MAX_SAFE_INTEGER).
      fileSize: {
        type: DataTypes.BIGINT,
        allowNull: false,
        validate: { min: 0 },
        field: "file_size",
      },
      // NB: VARCHAR + validación isIn (no ENUM nativo): las etiquetas de enum
      // de Postgres se limitan a 63 bytes y los MIME de DOCX/XLSX (72-73 chars)
      // los superan. En BD hay un CHECK equivalente (migración).
      mimeType: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: "mime_type",
        validate: {
          isIn: [
            [
              "application/pdf",
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ],
          ],
        },
      },
      // Cliente al que pertenece el documento (2026-07-23). Nullable: hay
      // documentos internos que no son de ningún cliente. El owner_user_id ya
      // dice quién lo subió; esto dice PARA QUIÉN es, para verlo desde su ficha.
      clientId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: "client_id",
      },
    },
    {
      tableName: "documents",
      indexes: [
        { fields: ["owner_user_id", "visibility"], name: "documents_owner_vis_idx" },
        { fields: ["folder_id"], name: "documents_folder_idx" },
      ],
    }
  );
}
