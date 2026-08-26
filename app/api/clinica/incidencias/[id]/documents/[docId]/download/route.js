import { withTenant } from "../../../../../../../../lib/tenant/withTenant.js";
import { error, forbidden, notFound, serverError } from "../../../../../../../../lib/utils/apiResponse.js";
import { readDocumentStream } from "../../../../../../../../lib/documents/documentStorage.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

/**
 * GET /api/clinica/incidencias/[id]/documents/[docId]/download
 * Sirve el fichero por STREAM (Content-Disposition: attachment). Aislado a los
 * documentos de ESTA incidencia (source='incidencia').
 */
export const GET = withTenant(async (_request, { params }, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica/Pacientes no activo");
    if (!ctx.hasModule("team_avanzado")) return forbidden("Módulo Equipo avanzado no activo");
    const { id, docId } = await params;
    if (!UUID_RE.test(id) || !UUID_RE.test(docId)) return error("id inválido");
    const { Document } = ctx.tenantModels;

    const row = await Document.findOne({ where: { id: docId, incidenciaId: id, source: "incidencia" } });
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
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Content-Length": String(size),
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
