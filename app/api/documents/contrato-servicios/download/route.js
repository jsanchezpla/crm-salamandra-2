import { Readable } from "node:stream";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { MODULE_KEYS } from "../../../../../lib/tenant/moduleKeys.js";
import { readDocumentStream } from "../../../../../lib/documents/documentStorage.js";
import { buscarContrato } from "../../../../../lib/documents/contratoServicios.js";

/**
 * GET /api/documents/contrato-servicios/download — descarga el contrato del
 * centro por STREAM, para revisarlo antes de dárselo a firmar a nadie.
 */
export const GET = withTenant(async (_request, _rc, ctx) => {
  try {
    if (!ctx.hasModule(MODULE_KEYS.DOCUMENTS)) return forbidden("Módulo Documentos no activo");
    const { Document } = ctx.tenantModels;
    const doc = await buscarContrato(Document);
    if (!doc) return notFound("Todavía no hay contrato subido");

    let stream;
    let size;
    try {
      ({ stream, size } = await readDocumentStream(ctx.tenant.slug, doc.storagePath));
    } catch (err) {
      if (err.code === "ENOENT") return notFound("Archivo físico no encontrado");
      throw err;
    }

    const safeName = String(doc.fileName || "contrato.pdf").replace(/[\r\n"]/g, "_");
    return new Response(Readable.toWeb(stream), {
      status: 200,
      headers: {
        "Content-Type": doc.mimeType || "application/octet-stream",
        "Content-Disposition": `inline; filename="${safeName}"`,
        "Content-Length": String(size),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
