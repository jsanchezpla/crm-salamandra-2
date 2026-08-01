import { Readable } from "node:stream";
import { withTenant } from "@/lib/tenant/withTenant.js";
import { error, forbidden, notFound, unauthorized, serverError } from "@/lib/utils/apiResponse.js";
import { MODULE_KEYS } from "@/lib/tenant/moduleKeys.js";
import { canView, contentDisposition } from "@/lib/documents/helpers.js";
import { readDocumentStream } from "@/lib/documents/documentStorage.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/documents/[id]/download — descarga forzada (attachment) por STREAM.
 * No bufferiza el archivo (sirve 25 MB sin doblar RAM). Content-Type real +
 * nosniff. Cualquier tipo permitido (PDF/DOCX/XLSX) se descarga aquí.
 */
export const GET = withTenant(async (request, { params }, ctx) => {
  try {
    if (!ctx.hasModule(MODULE_KEYS.DOCUMENTS_AVANZADO)) return forbidden("Módulo documents no activo");
    const userId = request.headers.get("x-user-id");
    if (!userId) return unauthorized();
    const { id } = await params;
    if (!UUID_RE.test(id)) return error("id inválido", 400);

    const { Document } = ctx.tenantModels;
    const doc = await Document.findByPk(id);
    if (!doc) return notFound("Documento no encontrado");
    if (!canView(doc, userId)) return forbidden("Sin acceso a este documento");

    let stream;
    let size;
    try {
      ({ stream, size } = await readDocumentStream(ctx.slug, doc.storagePath));
    } catch (e) {
      if (e.code === "ENOENT") return notFound("Archivo físico no encontrado");
      throw e;
    }

    return new Response(Readable.toWeb(stream), {
      status: 200,
      headers: {
        "Content-Type": doc.mimeType,
        "Content-Disposition": contentDisposition("attachment", doc.fileName),
        "Content-Length": String(size),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
