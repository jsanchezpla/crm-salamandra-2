import { Op } from "sequelize";
import { withTenant } from "../../../../../../../lib/tenant/withTenant.js";
import { error, forbidden, notFound, serverError } from "../../../../../../../lib/utils/apiResponse.js";
import { readDocumentStream } from "../../../../../../../lib/documents/documentStorage.js";
import { tipoParaVerEnPantalla } from "../../../../../../../lib/documents/verEnPantalla.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

/**
 * GET /api/pacientes/[id]/documents/[docId]/download
 * Sirve el fichero por STREAM (Content-Disposition: attachment). Aislado a los
 * documentos de ESTE paciente (source='paciente').
 */
export const GET = withTenant(async (request, { params }, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica/Pacientes no activo");
    const { id, docId } = await params;
    if (!UUID_RE.test(id) || !UUID_RE.test(docId)) return error("id inválido");
    const { Document } = ctx.tenantModels;

    // "incidencia" también: los adjuntos de incidencias con este paciente se
    // listan en su ficha y tienen que poder descargarse desde ella.
    const row = await Document.findOne({ where: { id: docId, patientId: id, source: { [Op.in]: ["paciente", "incidencia", "sesion", "sesion_preparacion"] } } });
    if (!row) return notFound("Documento no encontrado");

    let stream;
    let size;
    try {
      ({ stream, size } = await readDocumentStream(ctx.tenant.slug, row.storagePath));
    } catch (err) {
      if (err.code === "ENOENT") return notFound("Archivo físico no encontrado");
      throw err;
    }

    // Ver sin descargar (02/09/2026, AV-0025 de Aumenta): con `?ver=1` un PDF o
    // una imagen se sirve en línea, con el tipo que dice la lista blanca por
    // EXTENSIÓN guardada y nunca el `mimeType` que declaró quien lo subió. Lo
    // que no esté en la lista se descarga igual que siempre.
    const quiereVer = new URL(request.url).searchParams.get("ver") === "1";
    const tipoEnLinea = quiereVer ? tipoParaVerEnPantalla(row.storagePath || row.fileName) : null;

    const safeName = String(row.fileName || "archivo").replace(/[\r\n"]/g, "_");
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": tipoEnLinea || row.mimeType || "application/octet-stream",
        "Content-Disposition": `${tipoEnLinea ? "inline" : "attachment"}; filename="${safeName}"`,
        "Content-Length": String(size),
        "X-Content-Type-Options": "nosniff",
        ...(tipoEnLinea ? { "Content-Security-Policy": "default-src 'none'; object-src 'self'" } : {}),
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
