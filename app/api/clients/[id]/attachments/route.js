import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { randomUUID } from "node:crypto";
import {
  ok,
  created,
  error,
  forbidden,
  notFound,
  serverError,
} from "../../../../../lib/utils/apiResponse.js";
import {
  MAX_FILE_SIZE_BYTES,
  TENANT_QUOTA_BYTES,
  getTenantStorageUsage,
  saveDocumentFile,
  deleteDocumentFile,
  sanitizeFileName,
  extFromFileName,
} from "../../../../../lib/documents/documentStorage.js";

/**
 * Adjuntos de la ficha de cliente.
 *
 * ARCHIVO CENTRAL (2026-07-23): estos endpoints ya NO usan la tabla
 * `client_attachments`, sino el archivo central `documents` (source='ficha').
 * Así, todo lo que se sube a un cliente aparece también en el buscador de
 * Documentos, y al revés. Se conserva la URL y la forma de respuesta para no
 * tocar el panel de la ficha.
 *
 * Los adjuntos de ficha se guardan como `shared`: los ve todo el equipo del
 * tenant (es el archivo común de la consulta), y quedan enlazados al cliente.
 */

const MAX_FILES_PER_CLIENT = 50;

// Un documento del archivo central, con la forma que espera el panel de la ficha.
function serializeParaFicha(doc) {
  return {
    id: doc.id,
    originalName: doc.fileName,
    mimeType: doc.mimeType,
    fileSize: Number(doc.fileSize),
    createdAt: doc.createdAt,
    uploadedBy: null, // el owner es un UUID; el panel tolera que no venga
  };
}

// Sólo los documentos de este cliente subidos desde su ficha.
function whereFichaDe(clientId) {
  return { clientId, source: "ficha" };
}

export const GET = withTenant(async (_request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("clients")) return forbidden("Módulo clients no activo");
    const { id } = await params;
    const { Client, Document } = tenantModels;

    const client = await Client.findByPk(id, { attributes: ["id"] });
    if (!client) return notFound("Cliente no encontrado");

    const rows = await Document.findAll({
      where: whereFichaDe(id),
      order: [["createdAt", "DESC"]],
    });

    return ok({
      attachments: rows.map(serializeParaFicha),
      total: rows.length,
      limit: MAX_FILES_PER_CLIENT,
    });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(
  async (request, { params }, { tenant, tenantModels, hasModule }) => {
    try {
      if (!hasModule("clients")) return forbidden("Módulo clients no activo");
      const { id } = await params;
      const { Client, Document } = tenantModels;
      const ownerUserId = request.headers.get("x-user-id");
      if (!ownerUserId) return error("No autorizado", 401);

      const client = await Client.findByPk(id, { attributes: ["id"] });
      if (!client) return notFound("Cliente no encontrado");

      const currentCount = await Document.count({ where: whereFichaDe(id) });
      if (currentCount >= MAX_FILES_PER_CLIENT) {
        return error(`Límite alcanzado: máximo ${MAX_FILES_PER_CLIENT} archivos por cliente`, 422);
      }

      let formData;
      try {
        formData = await request.formData();
      } catch {
        return error("Body inválido: se esperaba multipart/form-data", 400);
      }

      const file = formData.get("file");
      if (!file || typeof file === "string") {
        return error("Campo 'file' obligatorio (multipart)", 422);
      }

      // Archivo central: se acepta CUALQUIER tipo (antes solo PDF).
      const declaredMime = file.type || "application/octet-stream";
      if (typeof file.size === "number" && file.size > MAX_FILE_SIZE_BYTES) {
        return error(`Archivo demasiado grande. Máximo: ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`, 413);
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const realSize = buffer.length;
      if (realSize > MAX_FILE_SIZE_BYTES) {
        return error(`Archivo demasiado grande. Máximo: ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`, 413);
      }

      const usage = await getTenantStorageUsage(tenant.slug);
      if (usage + realSize > TENANT_QUOTA_BYTES) {
        return error(`Cuota de almacenamiento superada`, 507);
      }

      const documentId = randomUUID();
      const ext = extFromFileName(file.name);
      // NOMBRE del documento en el CRM (el modal de la UI lo exige). Si viene, se
      // usa como nombre para mostrar conservando la extensión; si no, el del fichero.
      const nameRaw = formData.get("name");
      const providedName = typeof nameRaw === "string" ? nameRaw.trim().slice(0, 200) : "";
      const yaTieneExt = /\.[A-Za-z0-9]{1,10}$/.test(providedName);
      const fileName = providedName
        ? sanitizeFileName(yaTieneExt || !ext ? providedName : `${providedName}.${ext}`)
        : sanitizeFileName(file.name || "archivo");
      // Los adjuntos de ficha son compartidos con el equipo del tenant.
      const storagePath = await saveDocumentFile(tenant.slug, "shared", documentId, buffer, ext);

      let row;
      try {
        row = await Document.create({
          id: documentId,
          folderId: null,
          visibility: "shared",
          ownerUserId,
          fileName,
          storagePath,
          fileSize: realSize,
          mimeType: declaredMime,
          clientId: id,
          source: "ficha",
        });
      } catch (dbErr) {
        await deleteDocumentFile(tenant.slug, storagePath);
        throw dbErr;
      }

      return created(serializeParaFicha(row.toJSON()));
    } catch (err) {
      return serverError(err);
    }
  }
);
