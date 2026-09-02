import { Readable } from "node:stream";
import { withTenant } from "@/lib/tenant/withTenant.js";
import { error, forbidden, notFound, unauthorized, serverError } from "@/lib/utils/apiResponse.js";
import { MODULE_KEYS } from "@/lib/tenant/moduleKeys.js";
import { canViewDocument, contentDisposition } from "@/lib/documents/helpers.js";
import { carpetasCompartidasCon } from "@/lib/documents/carpetasCompartidas.js";
import { readDocumentStream } from "@/lib/documents/documentStorage.js";
import { resolveCurrentTeamMemberId } from "@/lib/team/currentTeamMember.js";
import { marcarLeido } from "@/lib/documents/lecturas.js";
import { tipoParaVerEnPantalla } from "@/lib/documents/verEnPantalla.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/documents/[id]/preview — vista inline SOLO para PDF.
 * DOCX/XLSX no se sirven inline (se descargan). Endurecido contra XSS por
 * servir contenido de usuario desde el origen de la app:
 *   - Content-Type: application/pdf forzado + X-Content-Type-Options: nosniff
 *   - CSP default-src 'none'; object-src 'self' (solo embebido, nada más).
 *
 * Sella la lectura igual que la descarga (01/09/2026): abrir la vista previa de
 * un PDF ES leerlo, y obligar a descargarlo para que baje el aviso sería pedir
 * dos veces lo mismo.
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
    // Además de lo de siempre: lo que vive en una carpeta compartida conmigo.
    const { todas } = await carpetasCompartidasCon({ tenantModels: ctx.tenantModels, userId });
    if (!canViewDocument(doc, userId, todas)) return forbidden("Sin acceso a este documento");
    // Qué se enseña en línea y como qué lo decide la lista blanca por EXTENSIÓN
    // guardada (PDF e imágenes; SVG nunca), no el `mimeType` que declaró quien
    // subió el fichero. Desde el 02/09/2026 (AV-0025 de Aumenta) ya no es solo PDF.
    const tipoEnLinea = tipoParaVerEnPantalla(doc.storagePath || doc.fileName);
    if (!tipoEnLinea) {
      return error("Este tipo de archivo no se puede ver en pantalla: descárgalo.", 400);
    }

    let stream;
    let size;
    try {
      ({ stream, size } = await readDocumentStream(ctx.slug, doc.storagePath));
    } catch (e) {
      if (e.code === "ENOENT") return notFound("Archivo físico no encontrado");
      throw e;
    }

    const miTm = await resolveCurrentTeamMemberId(request, ctx.tenantModels);
    if (miTm) await marcarLeido({ tenantModels: ctx.tenantModels, documentId: doc.id, teamMemberId: miTm });

    return new Response(Readable.toWeb(stream), {
      status: 200,
      headers: {
        "Content-Type": tipoEnLinea,
        "Content-Disposition": contentDisposition("inline", doc.fileName),
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
