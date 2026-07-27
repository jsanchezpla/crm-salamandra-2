import { randomUUID } from "node:crypto";
import { withTenant } from "@/lib/tenant/withTenant.js";
import { ok, created, error, forbidden, unauthorized, serverError } from "@/lib/utils/apiResponse.js";
import { serializeDocument, ownerSegmentFor } from "@/lib/documents/helpers.js";
import {
  MAX_FILE_SIZE_BYTES,
  TENANT_QUOTA_BYTES,
  getTenantStorageUsage,
  saveDocumentFile,
  deleteDocumentFile,
  sanitizeFileName,
  extFromFileName,
} from "@/lib/documents/documentStorage.js";

/**
 * /api/team/me/documents — documentación personal que el propio miembro sube en
 * su ficha de Equipo (CV, titulaciones, etc.). Reutiliza el almacén de
 * documentos pero NO depende del módulo `documents`: se gatea a nivel de tenant
 * (team o clinica) y SIEMPRE se acota al usuario dueño (ownerUserId + source
 * "equipo"), para que las terapeutas puedan gestionar SUS documentos sin ver ni
 * tocar el archivo general del centro.
 */
const SOURCE = "equipo";
const MB = 1024 * 1024;

function teamGate(ctx) {
  const has = ctx.tenantHasModule ? ctx.tenantHasModule.bind(ctx) : ctx.hasModule.bind(ctx);
  return has("team") || has("clinica");
}

export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    if (!teamGate(ctx)) return forbidden("Módulo equipo no activo");
    const userId = request.headers.get("x-user-id");
    if (!userId) return unauthorized();
    const { Document } = ctx.tenantModels;
    if (!Document) return ok({ documents: [] });
    const rows = await Document.findAll({
      where: { ownerUserId: userId, source: SOURCE },
      order: [["createdAt", "DESC"]],
      limit: 200,
    });
    return ok({ documents: rows.map((d) => serializeDocument(d, null)) });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, _rc, ctx) => {
  try {
    if (!teamGate(ctx)) return forbidden("Módulo equipo no activo");
    const userId = request.headers.get("x-user-id");
    if (!userId) return unauthorized();
    const { Document } = ctx.tenantModels;
    if (!Document) return error("Documentos no disponibles", 422);

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength && contentLength > MAX_FILE_SIZE_BYTES + MB) {
      return error(`Archivo demasiado grande. Máximo: ${MAX_FILE_SIZE_BYTES / MB} MB`, 413);
    }
    let form;
    try { form = await request.formData(); } catch { return error("Body inválido: se esperaba multipart/form-data", 400); }
    const file = form.get("file");
    if (!file || typeof file === "string") return error("Campo 'file' obligatorio (multipart)", 400);
    if (typeof file.size === "number" && file.size > MAX_FILE_SIZE_BYTES) {
      return error(`Archivo demasiado grande. Máximo: ${MAX_FILE_SIZE_BYTES / MB} MB`, 413);
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length > MAX_FILE_SIZE_BYTES) return error(`Archivo demasiado grande. Máximo: ${MAX_FILE_SIZE_BYTES / MB} MB`, 413);

    const usage = await getTenantStorageUsage(ctx.slug);
    if (usage + buffer.length > TENANT_QUOTA_BYTES) {
      return error(`Cuota de almacenamiento superada (${(TENANT_QUOTA_BYTES / (1024 * MB)).toFixed(0)} GB por tenant)`, 507);
    }

    const documentId = randomUUID();
    const ext = extFromFileName(file.name);
    const nameRaw = form.get("name");
    const providedName = typeof nameRaw === "string" ? nameRaw.trim().slice(0, 200) : "";
    let fileName;
    if (providedName) {
      const yaTieneExt = /\.[A-Za-z0-9]{1,10}$/.test(providedName);
      fileName = sanitizeFileName(yaTieneExt || !ext ? providedName : `${providedName}.${ext}`);
    } else {
      fileName = sanitizeFileName(file.name);
    }

    const ownerSegment = ownerSegmentFor("private", userId);
    const storagePath = await saveDocumentFile(ctx.slug, ownerSegment, documentId, buffer, ext);
    let row;
    try {
      row = await Document.create({
        id: documentId,
        folderId: null,
        visibility: "private",
        ownerUserId: userId,
        fileName,
        storagePath,
        fileSize: buffer.length,
        mimeType: file.type || "application/octet-stream",
        source: SOURCE,
      });
    } catch (dbErr) {
      await deleteDocumentFile(ctx.slug, storagePath);
      throw dbErr;
    }
    return created(serializeDocument(row, null));
  } catch (err) {
    return serverError(err);
  }
});
