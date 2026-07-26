import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { error, forbidden, notFound, noContent, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { deleteDocumentFile } from "../../../../../../lib/documents/documentStorage.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

/**
 * DELETE /api/pacientes/[id]/documents/[docId]
 * Borra un documento del paciente (fichero + fila). Aislado: solo documentos de
 * ESTE paciente y source='paciente' (no toca contratos-plantilla ni otros).
 */
export const DELETE = withTenant(async (_request, { params }, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica/Pacientes no activo");
    const { id, docId } = await params;
    if (!UUID_RE.test(id) || !UUID_RE.test(docId)) return error("id inválido");
    const { Document } = ctx.tenantModels;

    const row = await Document.findOne({ where: { id: docId, patientId: id, source: "paciente" } });
    if (!row) return notFound("Documento no encontrado");

    const storagePath = row.storagePath;
    await row.destroy();
    await deleteDocumentFile(ctx.tenant.slug, storagePath).catch(() => {});
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
