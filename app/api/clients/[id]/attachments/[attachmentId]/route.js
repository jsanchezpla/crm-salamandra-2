import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import {
  ok,
  error,
  noContent,
  forbidden,
  notFound,
  serverError,
} from "../../../../../../lib/utils/apiResponse.js";
import { deleteDocumentFile } from "../../../../../../lib/documents/documentStorage.js";

/**
 * PATCH /api/clients/[id]/attachments/[attachmentId]
 *
 * Cambia si el PACIENTE ve el documento en su portal.
 *   { visibleToClient: true | false }
 *
 * Solo sobre adjuntos de ficha (source='ficha') de ESE cliente, igual que el
 * DELETE. Lo que subió el propio paciente no se puede ocultar: es suyo y lo ve
 * siempre en su portal (ocultárselo sería confuso, no una medida de privacidad).
 */
export const PATCH = withTenant(
  async (request, { params }, { tenantModels, hasModule }) => {
    try {
      if (!hasModule("clients")) return forbidden("Módulo clients no activo");
      const { id, attachmentId } = await params;
      const { Document } = tenantModels;

      let body;
      try {
        body = await request.json();
      } catch {
        return error("Body inválido");
      }
      if (typeof body.visibleToClient !== "boolean") {
        return error("Indica visibleToClient (true/false)", 422);
      }

      const row = await Document.findOne({
        where: { id: attachmentId, clientId: id, source: "ficha" },
      });
      if (!row) return notFound("Adjunto no encontrado");

      if (row.uploadedByClient) {
        return error("Este documento lo subió el paciente: siempre lo ve en su portal.", 422);
      }

      await row.update({ clientVisible: body.visibleToClient });
      return ok({ id: row.id, clientVisible: row.clientVisible });
    } catch (err) {
      return serverError(err);
    }
  }
);

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

      // source:'ficha' (arreglo 2026-07-23): esta ruta SOLO opera sobre adjuntos
      // de ficha. Sin el filtro alcanzaba cualquier documento del cliente en el
      // archivo central (source='manual', privado de otro usuario) y lo borraba,
      // saltandose la regla "solo el dueño borra" del modulo Documentos.
      const row = await Document.findOne({
        where: { id: attachmentId, clientId: id, source: "ficha" },
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
