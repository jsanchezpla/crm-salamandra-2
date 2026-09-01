import { withTenant } from "../../../../../../../lib/tenant/withTenant.js";
import { error, forbidden, notFound, noContent, serverError } from "../../../../../../../lib/utils/apiResponse.js";
import { deleteDocumentFile } from "../../../../../../../lib/documents/documentStorage.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * DELETE /api/citas/bloqueos/[id]/documents/[docId] — quitar un documento del
 * bloqueo (01/09/2026).
 *
 * Borra de verdad: fila + fichero, como en incidencias. El documento nació con
 * el bloqueo (`source='bloqueo'`), así que aquí «quitarlo» y «borrarlo» son lo
 * mismo — si estuviera además en la ficha de alguien, la puerta sería otra.
 * Sus lecturas pedidas se van con él (FK ON DELETE CASCADE): sin documento no
 * hay nada que leer.
 *
 * Aislado al bloqueo de la URL: un docId de otro tramo no se toca desde aquí.
 */
export const DELETE = withTenant(async (_request, { params }, ctx) => {
  try {
    if (!ctx.hasModule("citas")) return forbidden("Módulo citas no activo");
    const { id, docId } = await params;
    if (!UUID_RE.test(id) || !UUID_RE.test(docId)) return error("id inválido");
    const { Document } = ctx.tenantModels;
    if (!Document) return notFound("Documento no encontrado");

    const row = await Document.findOne({ where: { id: docId, teamBlockId: id, source: "bloqueo" } });
    if (!row) return notFound("Documento no encontrado");

    const storagePath = row.storagePath;
    await row.destroy();
    await deleteDocumentFile(ctx.tenant.slug, storagePath).catch(() => {});
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
