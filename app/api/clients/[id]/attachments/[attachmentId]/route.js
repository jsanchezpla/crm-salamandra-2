import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import {
  noContent,
  forbidden,
  serverError,
} from "../../../../../../lib/utils/apiResponse.js";
import { deleteDocumentFile } from "../../../../../../lib/documents/documentStorage.js";

/**
 * DELETE /api/clients/[id]/attachments/[attachmentId]
 *
 * Borra un adjunto de la ficha. Desde 2026-07-23 los adjuntos son documentos
 * del archivo central (source='ficha'): se borra la fila y el fichero.
 * Idempotente: si no existe, 204.
 *
 * Orden: BD primero (transacción rápida), luego best-effort en disco.
 */
export const DELETE = withTenant(
  async (_request, { params }, { tenant, tenantModels, hasModule }) => {
    try {
      if (!hasModule("clients")) return forbidden("Módulo clients no activo");
      const { id, attachmentId } = await params;
      const { Document } = tenantModels;

      const row = await Document.findOne({
        where: { id: attachmentId, clientId: id },
      });
      if (!row) return noContent(); // idempotente

      const { storagePath } = row;
      await row.destroy();
      await deleteDocumentFile(tenant.slug, storagePath);

      return noContent();
    } catch (err) {
      return serverError(err);
    }
  }
);
