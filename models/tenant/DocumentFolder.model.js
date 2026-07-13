import { DataTypes } from "sequelize";

/**
 * DocumentFolder — carpeta del módulo Documents (estilo Drive básico).
 *
 * Árbol de máximo 4 niveles (level 0=raíz .. 3). El anidamiento se controla con
 * `parentFolderId` (self-FK) + `level` (CHECK 0..3 en BD + validate en modelo).
 *
 * Visibilidad:
 *   - private → solo la ve/edita su `ownerUserId`.
 *   - shared  → la ven/leen todos los usuarios del tenant; solo el owner
 *               (quien la creó) puede renombrarla o borrarla.
 *
 * El borrado hace CASCADE en BD (subcarpetas + documentos); los archivos
 * físicos los borra el endpoint DELETE (FK CASCADE no toca disco).
 */
export function defineDocumentFolder(sequelize) {
  return sequelize.define(
    "DocumentFolder",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      // Self-FK. NULL = carpeta raíz.
      parentFolderId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: "parent_folder_id",
      },
      visibility: {
        type: DataTypes.ENUM("private", "shared"),
        allowNull: false,
      },
      // Creador. Siempre presente; en shared indica quién la creó (pero todos ven).
      ownerUserId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: "owner_user_id",
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      // 0=raíz .. 3. CHECK (0..3) en BD; aquí validación de aplicación.
      level: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        validate: { min: 0, max: 3 },
      },
    },
    {
      tableName: "document_folders",
      indexes: [
        // Evita 2 carpetas con mismo nombre en el mismo nivel para el mismo
        // owner y visibility. Nota: en Postgres los NULL son distintos, así que
        // para carpetas raíz (parent NULL) el endpoint también valida duplicados.
        {
          unique: true,
          fields: ["parent_folder_id", "name", "visibility", "owner_user_id"],
          name: "document_folders_dedup_idx",
        },
        // Parcial para la raíz (parent NULL), donde el UNIQUE de arriba no dedup.
        {
          unique: true,
          fields: ["name", "visibility", "owner_user_id"],
          where: { parent_folder_id: null },
          name: "document_folders_root_dedup_idx",
        },
        { fields: ["owner_user_id", "visibility"], name: "document_folders_owner_vis_idx" },
        { fields: ["parent_folder_id"], name: "document_folders_parent_idx" },
      ],
    }
  );
}
