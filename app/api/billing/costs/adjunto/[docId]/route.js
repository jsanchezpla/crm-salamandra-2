import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { readDocumentStream } from "../../../../../../lib/documents/documentStorage.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/billing/costs/adjunto/[docId] — sirve la factura externa de un
 * gasto por stream. Gateado por `billing` (no por Documentos avanzado, a
 * propósito): la subió Facturación y la abre Facturación. Aislado a los
 * ficheros subidos por esa puerta (source='gasto').
 */
export const GET = withTenant(async (_request, { params }, ctx) => {
  try {
    if (!ctx.hasModule("billing")) return forbidden("Módulo billing no activo");
    const { docId } = await params;
    if (!UUID_RE.test(docId)) return error("id inválido");
    const { Document } = ctx.tenantModels;

    const row = await Document.findOne({ where: { id: docId, source: "gasto" } });
    if (!row) return notFound("Documento no encontrado");

    let stream;
    let size;
    try {
      ({ stream, size } = await readDocumentStream(ctx.tenant.slug, row.storagePath));
    } catch (err) {
      if (err.code === "ENOENT") return notFound("Archivo físico no encontrado");
      throw err;
    }

    const safeName = String(row.fileName || "archivo").replace(/[\r\n"]/g, "_");
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": row.mimeType || "application/octet-stream",
        "Content-Disposition": `inline; filename="${safeName}"`,
        "Content-Length": String(size),
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
