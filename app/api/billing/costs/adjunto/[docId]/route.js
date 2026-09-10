import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { readDocumentStream } from "../../../../../../lib/documents/documentStorage.js";
import { contentDisposition } from "../../../../../../lib/documents/helpers.js";
import { tipoParaVerEnPantalla } from "../../../../../../lib/documents/verEnPantalla.js";

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

    /*
     * QUÉ SE VE EN PANTALLA Y QUÉ SE DESCARGA (10/09/2026). Desde que la
     * factura de un gasto puede llegar en Word o en Excel —y no solo en PDF—,
     * servirlo todo «inline» con el `mimeType` que declaró quien lo subió sería
     * dejar que quien sube decida cómo se lo servimos al que mira: un .html
     * colado por esta puerta se ejecutaría en NUESTRO origen. La regla es la
     * misma del resto del CRM (lib/documents/verEnPantalla.js) y mira la
     * extensión que guardamos nosotros: PDF e imágenes se ven, lo demás se
     * descarga, que es como se abre un Word de todas formas.
     */
    const tipoEnLinea = tipoParaVerEnPantalla(row.storagePath || row.fileName);
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": tipoEnLinea || "application/octet-stream",
        "Content-Disposition": contentDisposition(tipoEnLinea ? "inline" : "attachment", row.fileName || "archivo"),
        "Content-Length": String(size),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; object-src 'self'",
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
