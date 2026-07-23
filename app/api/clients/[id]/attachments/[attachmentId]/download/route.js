import { withTenant } from "../../../../../../../lib/tenant/withTenant.js";
import { forbidden, notFound, serverError } from "../../../../../../../lib/utils/apiResponse.js";
import { readDocumentStream } from "../../../../../../../lib/documents/documentStorage.js";

/**
 * GET /api/clients/[id]/attachments/[attachmentId]/download
 *
 * Descarga un adjunto de la ficha. Desde 2026-07-23 los adjuntos viven en el
 * archivo central (tabla documents, source='ficha'); este endpoint sirve el
 * fichero por STREAM con Content-Disposition: attachment.
 *
 * Requiere JWT + módulo clients. Se comprueba que el documento sea de ESTE
 * cliente (aislamiento).
 */
export const GET = withTenant(
  async (_request, { params }, { tenant, tenantModels, hasModule }) => {
    try {
      if (!hasModule("clients")) return forbidden("Módulo clients no activo");
      const { id, attachmentId } = await params;
      const { Document } = tenantModels;

      const row = await Document.findOne({
        where: { id: attachmentId, clientId: id },
      });
      if (!row) return notFound("Adjunto no encontrado");

      let stream;
      let size;
      try {
        ({ stream, size } = await readDocumentStream(tenant.slug, row.storagePath));
      } catch (err) {
        if (err.code === "ENOENT") return notFound("Archivo físico no encontrado");
        throw err;
      }

      const safeName = String(row.fileName || "archivo").replace(/[\r\n"]/g, "_");

      return new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": row.mimeType || "application/octet-stream",
          "Content-Disposition": `attachment; filename="${safeName}"`,
          "Content-Length": String(size),
          "Cache-Control": "private, no-cache",
        },
      });
    } catch (err) {
      return serverError(err);
    }
  }
);
