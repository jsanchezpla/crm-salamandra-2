import { randomUUID } from "node:crypto";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { created, error, forbidden, serverError } from "../../../../../lib/utils/apiResponse.js";
import {
  MAX_FILE_SIZE_BYTES,
  quotaBytesDe,
  getTenantStorageUsage,
  saveDocumentFile,
  deleteDocumentFile,
  sanitizeFileName,
  extFromFileName,
} from "../../../../../lib/documents/documentStorage.js";

/**
 * POST /api/billing/costs/adjunto — la factura externa de un gasto (31/08/2026).
 *
 * Sube el archivo ANTES de crear el gasto (multipart, campo `file`) y devuelve
 * la URL que el formulario guarda en `costs.attachment_url` — la columna
 * existía desde siempre pero no había ni upload ni campo. El fichero vive en
 * el archivo central (`documents`, source='gasto') con la cuota de disco de
 * siempre, pero se sirve por la puerta de ESTE módulo
 * (GET /api/billing/costs/adjunto/[docId]), no por la del archivo avanzado:
 * quien tiene Facturación abre sus facturas de gasto tenga o no Documentos.
 */
export const POST = withTenant(async (request, _rc, ctx) => {
  try {
    if (!ctx.hasModule("billing")) return forbidden("Módulo billing no activo");
    const ownerUserId = request.headers.get("x-user-id");
    if (!ownerUserId) return error("No autorizado", 401);
    const { Document } = ctx.tenantModels;
    if (!Document) return error("El archivo no está disponible en este cliente", 503);

    let form;
    try { form = await request.formData(); } catch { return error("Body inválido: se esperaba multipart/form-data", 400); }
    const file = form.get("file");
    if (!file || typeof file === "string") return error("Campo 'file' obligatorio (multipart)", 422);

    const declaredMime = file.type || "application/octet-stream";
    if (typeof file.size === "number" && file.size > MAX_FILE_SIZE_BYTES) {
      return error(`Archivo demasiado grande. Máximo: ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`, 413);
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      return error(`Archivo demasiado grande. Máximo: ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`, 413);
    }
    const usage = await getTenantStorageUsage(ctx.tenant.slug);
    if (usage + buffer.length > quotaBytesDe(ctx)) return error("Cuota de almacenamiento superada", 507);

    const ext = extFromFileName(file.name);
    const fileName = sanitizeFileName(file.name || `adjunto${ext ? "." + ext : ""}`);
    const documentId = randomUUID();
    const storagePath = await saveDocumentFile(ctx.tenant.slug, "shared", documentId, buffer, ext);

    try {
      await Document.create({
        id: documentId,
        folderId: null,
        visibility: "shared",
        ownerUserId,
        fileName,
        storagePath,
        fileSize: buffer.length,
        mimeType: declaredMime,
        source: "gasto",
      });
    } catch (dbErr) {
      await deleteDocumentFile(ctx.tenant.slug, storagePath);
      throw dbErr;
    }

    return created({ documentId, fileName, url: `/api/billing/costs/adjunto/${documentId}` });
  } catch (err) {
    return serverError(err);
  }
});
