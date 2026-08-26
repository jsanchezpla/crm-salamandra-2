import { DataTypes } from "sequelize";

/**
 * Document — archivo del módulo Documents. Solo metadatos en BD; los bytes
 * viven en el volumen local (ver `lib/documents/documentStorage.js`).
 *
 * `storagePath` es el path RELATIVO a UPLOADS_ROOT
 *   documents/{tenantSlug}/{ownerUserId | shared}/{documentUUID}.{ext}
 * `fileSize` son bytes REALES medidos en servidor al subir (nunca `file.size`
 * del cliente).
 *
 * ARCHIVO CENTRAL TRANSVERSAL (2026-07-23): esta tabla dejó de ser exclusiva
 * del módulo Documents. Ahora es el archivo único del CRM: cualquier módulo
 * sube aquí (una nota de cliente, la ficha, en el futuro una factura), y el
 * módulo Documents es solo el BUSCADOR. Por eso ya NO se restringe el MIME a
 * PDF/DOCX/XLSX — un archivo central que rechaza una foto no es un archivo
 * central. `source` dice de dónde vino cada documento y `clientId` para quién.
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
      // NULL solo para lo que sube el PACIENTE desde su portal: no es usuario
      // del CRM, así que no hay owner (ver `uploadedByClient`).
      ownerUserId: {
        type: DataTypes.UUID,
        allowNull: true,
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
      // MIME libre desde 2026-07-23 (archivo central transversal). Antes se
      // limitaba a PDF/DOCX/XLSX con isIn + CHECK en BD; el CHECK lo relaja la
      // migración migrate-documents-transversal. Solo se exige que no vaya
      // vacío. La validación de contenido real (magic bytes, tamaño) sigue
      // haciéndose al subir, en la capa de storage.
      mimeType: {
        type: DataTypes.STRING(150),
        allowNull: false,
        field: "mime_type",
        validate: { notEmpty: true },
      },
      // Cliente al que pertenece el documento (2026-07-23). Nullable: hay
      // documentos internos que no son de ningún cliente. El owner_user_id ya
      // dice quién lo subió; esto dice PARA QUIÉN es, para verlo desde su ficha.
      clientId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: "client_id",
      },
      // Paciente concreto al que pertenece el documento (2026-07-24). Nullable.
      // Un cliente pagador puede tener varios subpacientes; sin esto, "los docs
      // de este paciente" traería los de todos los hermanos bajo el mismo pagador.
      patientId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: "patient_id",
      },
      // Incidencia a la que se adjuntó (2026-08-26). Nullable: casi ningún
      // documento viene de una incidencia. Si la incidencia se borra, el
      // documento se queda (FK ON DELETE SET NULL): puede estar en la ficha
      // de un paciente y borrar la incidencia no debe llevárselo.
      incidenciaId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: "incidencia_id",
      },
      // De dónde vino el documento: "manual" (subido en el módulo Documents),
      // "ficha" (adjunto desde la ficha de un cliente), "paciente" (documento de
      // un paciente), "contract_template" (contrato estándar de la clínica,
      // reutilizable en todos los pacientes), "incidencia" (adjunto a una
      // incidencia del equipo), "nota", "factura"…
      // Sirve para filtrar el archivo central por origen.
      source: {
        type: DataTypes.STRING(40),
        allowNull: false,
        defaultValue: "manual",
      },
      // ¿Lo ve el PACIENTE en su portal? (2026-07-27). Por defecto NO: al
      // activar la feature nada de lo ya subido se expone por accidente. Solo
      // tiene sentido junto a `clientId`; lo decide quien sube desde la ficha.
      clientVisible: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: "client_visible",
      },
      // Lo subió el paciente desde su portal (no el equipo). Su propio archivo
      // siempre lo ve él, y en la ficha se marca para que Laura sepa de dónde
      // viene. Estos documentos van sin `ownerUserId`.
      uploadedByClient: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: "uploaded_by_client",
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
