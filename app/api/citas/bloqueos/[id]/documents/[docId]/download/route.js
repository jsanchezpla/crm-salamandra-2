import { Readable } from "node:stream";
import { withTenant } from "../../../../../../../../lib/tenant/withTenant.js";
import { error, forbidden, notFound, serverError } from "../../../../../../../../lib/utils/apiResponse.js";
import { readDocumentStream } from "../../../../../../../../lib/documents/documentStorage.js";
import { contentDisposition } from "../../../../../../../../lib/documents/helpers.js";
import { resolveCurrentTeamMemberId } from "../../../../../../../../lib/team/currentTeamMember.js";
import { marcarLeido } from "../../../../../../../../lib/documents/lecturas.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/citas/bloqueos/[id]/documents/[docId]/download — el acta del tramo.
 *
 * Sirve el fichero por STREAM y, de paso, SELLA LA LECTURA de quien lo abre:
 * leer es abrirlo, no declararlo (ver `lib/documents/lecturas.js`). El sello va
 * antes de responder pero no puede tumbar la descarga — `marcarLeido` no lanza.
 *
 * Aislado al bloqueo de la URL: aquí solo se descargan sus documentos.
 */
export const GET = withTenant(async (request, { params }, ctx) => {
  try {
    if (!ctx.hasModule("citas")) return forbidden("Módulo citas no activo");
    const { id, docId } = await params;
    if (!UUID_RE.test(id) || !UUID_RE.test(docId)) return error("id inválido");
    const { Document } = ctx.tenantModels;
    if (!Document) return notFound("Documento no encontrado");

    const row = await Document.findOne({ where: { id: docId, teamBlockId: id, source: "bloqueo" } });
    if (!row) return notFound("Documento no encontrado");

    let stream;
    let size;
    try {
      ({ stream, size } = await readDocumentStream(ctx.tenant.slug, row.storagePath));
    } catch (err) {
      if (err.code === "ENOENT") return notFound("Archivo físico no encontrado");
      throw err;
    }

    const miTm = await resolveCurrentTeamMemberId(request, ctx.tenantModels);
    if (miTm) await marcarLeido({ tenantModels: ctx.tenantModels, documentId: row.id, teamMemberId: miTm });

    return new Response(Readable.toWeb(stream), {
      status: 200,
      headers: {
        "Content-Type": row.mimeType || "application/octet-stream",
        "Content-Disposition": contentDisposition("attachment", row.fileName),
        "Content-Length": String(size),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
