import { withTenant } from "../../../../../../../lib/tenant/withTenant.js";
import { incidenciaFueraDeAlcance } from "../../../../../../../lib/clinica/alcanceIncidencias.js";
import { error, forbidden, notFound, noContent, serverError } from "../../../../../../../lib/utils/apiResponse.js";
import { deleteDocumentFile } from "../../../../../../../lib/documents/documentStorage.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

/**
 * DELETE /api/clinica/incidencias/[id]/documents/[docId]
 * Borra un documento de la incidencia (fichero + fila). Aislado: solo
 * documentos de ESTA incidencia (source='incidencia'). Si estaba en la ficha
 * de un paciente, desaparece también de allí: es el mismo documento.
 */
export const DELETE = withTenant(async (request, { params }, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica/Pacientes no activo");
    if (!ctx.hasModule("team_avanzado")) return forbidden("Módulo Equipo avanzado no activo");
    const { id, docId } = await params;
    if (!UUID_RE.test(id) || !UUID_RE.test(docId)) return error("id inválido");
    const { Document, Incidencia } = ctx.tenantModels;

    // Quién ve qué (02/09/2026): el adjunto es de su incidencia.
    const incidencia = await Incidencia.findByPk(id, { attributes: ["id", "reportedById", "assignedToId"] });
    if (!incidencia || (await incidenciaFueraDeAlcance(request, ctx, incidencia))) return notFound("Documento no encontrado");

    const row = await Document.findOne({ where: { id: docId, incidenciaId: id, source: "incidencia" } });
    if (!row) return notFound("Documento no encontrado");

    const storagePath = row.storagePath;
    await row.destroy();
    await deleteDocumentFile(ctx.tenant.slug, storagePath).catch(() => {});
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
