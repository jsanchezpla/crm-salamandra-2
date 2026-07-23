import { randomUUID } from "node:crypto";
import { Op } from "sequelize";
import { withTenant } from "@/lib/tenant/withTenant.js";
import { ok, created, error, forbidden, unauthorized, serverError } from "@/lib/utils/apiResponse.js";
import { MODULE_KEYS } from "@/lib/tenant/moduleKeys.js";
import {
  logDocumentsAudit,
  resolveOwnerNames,
  visibilityWhere,
  canCreateInside,
  ownerSegmentFor,
  serializeDocument,
} from "@/lib/documents/helpers.js";
import {
  MAX_FILE_SIZE_BYTES,
  TENANT_QUOTA_BYTES,
  isAllowedMime,
  validateMimeMagicBytes,
  getTenantStorageUsage,
  saveDocumentFile,
  deleteDocumentFile,
  sanitizeFileName,
  extFromFileName,
} from "@/lib/documents/documentStorage.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/documents?folderId=<uuid|null>&visibility=private|shared|all
export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    if (!ctx.hasModule(MODULE_KEYS.DOCUMENTS)) return forbidden("Módulo documents no activo");
    const userId = request.headers.get("x-user-id");
    if (!userId) return unauthorized();

    const { Document } = ctx.tenantModels;
    const sp = new URL(request.url).searchParams;
    const visibility = ["private", "shared", "all"].includes(sp.get("visibility")) ? sp.get("visibility") : "all";

    const where = visibilityWhere(userId, visibility);

    // Modo BÚSQUEDA (archivo central): filtrar por cliente, origen o texto
    // recorre TODO el archivo, ignorando la carpeta. Modo NAVEGACIÓN: se
    // mantiene el comportamiento por carpeta de siempre.
    const clientId = sp.get("clientId");
    const source = sp.get("source");
    const q = (sp.get("q") || "").trim();
    const modoBusqueda = clientId || source || q;

    if (clientId && clientId !== "null") {
      if (!UUID_RE.test(clientId)) return error("clientId inválido", 400);
      where.clientId = clientId;
    }
    if (source) where.source = source.slice(0, 40);
    if (q) where.fileName = { [Op.iLike]: `%${q}%` };

    if (!modoBusqueda) {
      const folderParam = sp.get("folderId");
      if (folderParam && folderParam !== "null") {
        if (!UUID_RE.test(folderParam)) return error("folderId inválido", 400);
        where.folderId = folderParam;
      } else {
        where.folderId = null;
      }
    }

    // LIMIT defensivo (sin paginación aún; la UI del Sprint 2 la añadirá).
    const rows = await Document.findAll({ where, order: [["fileName", "ASC"]], limit: 1000 });
    const names = await resolveOwnerNames(rows.map((r) => r.ownerUserId));
    return ok({ documents: rows.map((d) => serializeDocument(d, names.get(d.ownerUserId))) });
  } catch (err) {
    return serverError(err);
  }
});

// POST /api/documents (multipart: file + folderId? + visibility?)
export const POST = withTenant(async (request, _rc, ctx) => {
  try {
    if (!ctx.hasModule(MODULE_KEYS.DOCUMENTS)) return forbidden("Módulo documents no activo");
    const userId = request.headers.get("x-user-id");
    if (!userId) return unauthorized();

    const { Document, DocumentFolder } = ctx.tenantModels;

    // Guard por Content-Length ANTES de parsear: el runtime rechaza cuerpos
    // grandes en request.formData() (throw genérico) antes de que podamos medir
    // el archivo; así devolvemos un 413 claro en vez de un 400 de "body inválido".
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength && contentLength > MAX_FILE_SIZE_BYTES + 1024 * 1024) {
      return error(`Archivo demasiado grande. Máximo: ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`, 413);
    }

    let form;
    try {
      form = await request.formData();
    } catch {
      return error("Body inválido: se esperaba multipart/form-data", 400);
    }

    const file = form.get("file");
    if (!file || typeof file === "string") return error("Campo 'file' obligatorio (multipart)", 400);

    // Carpeta destino (opcional) → determina la visibilidad heredada.
    const folderRaw = form.get("folderId");
    const folderId = folderRaw && folderRaw !== "null" ? String(folderRaw) : null;
    let visibility;
    if (folderId) {
      if (!UUID_RE.test(folderId)) return error("folderId inválido", 400);
      const folder = await DocumentFolder.findByPk(folderId);
      if (!folder) return error("La carpeta no existe", 404);
      if (!canCreateInside(folder, userId)) return forbidden("Sin acceso a la carpeta destino");
      visibility = folder.visibility; // heredada
    } else {
      visibility = form.get("visibility");
      if (!["private", "shared"].includes(visibility)) {
        return error("visibility debe ser 'private' o 'shared' para documentos en la raíz", 400);
      }
    }

    // Archivo central transversal (2026-07-23): se acepta CUALQUIER tipo. Solo
    // se exige que venga un Content-Type. La comprobación de magic bytes sigue
    // aplicándose a los tipos que sabemos verificar (PDF/OOXML); para el resto
    // se confía en el Content-Type (el archivo se sirve como adjunto, nunca se
    // ejecuta).
    const declaredMime = file.type || "application/octet-stream";

    // Guard barato con el tamaño declarado (evita leer un archivo gigante).
    if (typeof file.size === "number" && file.size > MAX_FILE_SIZE_BYTES) {
      return error(`Archivo demasiado grande. Máximo: ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`, 413);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const realSize = buffer.length; // bytes REALES medidos en servidor
    if (realSize > MAX_FILE_SIZE_BYTES) {
      return error(`Archivo demasiado grande. Máximo: ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`, 413);
    }

    // Magic bytes SOLO para los tipos que sabemos verificar. Para el resto
    // (imágenes, txt, etc.) se acepta: es un archivo, no un ejecutable.
    if (isAllowedMime(declaredMime) && !validateMimeMagicBytes(buffer, declaredMime)) {
      return error("El contenido del archivo no coincide con su tipo declarado", 400);
    }

    // Cuota del tenant (bytes reales en disco + este archivo).
    const usage = await getTenantStorageUsage(ctx.slug);
    if (usage + realSize > TENANT_QUOTA_BYTES) {
      return error(
        `Cuota de almacenamiento superada (${(TENANT_QUOTA_BYTES / (1024 * 1024 * 1024)).toFixed(0)} GB por tenant)`,
        507
      );
    }

    const documentId = randomUUID();
    const fileName = sanitizeFileName(file.name);
    const ownerSegment = ownerSegmentFor(visibility, userId);

    // Escribir a disco; si el INSERT falla, limpiar el archivo (best-effort atómico).
    const ext = extFromFileName(file.name);
    const storagePath = await saveDocumentFile(ctx.slug, ownerSegment, documentId, buffer, ext);

    // Cliente opcional al que se asocia el documento subido desde el módulo.
    const clientIdRaw = form.get("clientId");
    const clientId = typeof clientIdRaw === "string" && UUID_RE.test(clientIdRaw) ? clientIdRaw : null;

    let row;
    try {
      row = await Document.create({
        id: documentId,
        folderId,
        visibility,
        ownerUserId: userId,
        fileName,
        storagePath,
        fileSize: realSize,
        mimeType: declaredMime,
        clientId,
        source: "manual",
      });
    } catch (dbErr) {
      await deleteDocumentFile(ctx.slug, storagePath);
      throw dbErr;
    }

    await logDocumentsAudit({
      tenantId: ctx.tenant.id,
      userId,
      action: "document.uploaded",
      entity: "Document",
      entityId: row.id,
      before: null,
      after: { fileName, mimeType: declaredMime, fileSize: realSize, visibility, folderId },
      ip: request.headers.get("x-forwarded-for"),
    });

    return created(serializeDocument(row, null));
  } catch (err) {
    return serverError(err);
  }
});
