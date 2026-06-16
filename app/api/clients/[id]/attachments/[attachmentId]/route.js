import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import {
  noContent,
  forbidden,
  notFound,
  serverError,
} from "../../../../../../lib/utils/apiResponse.js";
import { deleteAttachmentFile } from "../../../../../../lib/clients/attachmentStorage.js";

/**
 * DELETE /api/clients/[id]/attachments/[attachmentId]
 *
 * Borra fila BD + archivo físico. Idempotente:
 *   - Si el attachment no existe en BD, devuelve 204.
 *   - Si la fila se borra pero el archivo no estaba, no falla.
 *
 * Orden: borrar BD primero (transacción rápida), luego best-effort sobre
 * disco. Si el disco falla queda un huérfano físico (no es crítico —
 * el patrón inverso dejaría un huérfano más visible para el usuario).
 */
export const DELETE = withTenant(
  async (_request, { params }, { tenant, tenantModels, hasModule }) => {
    try {
      if (!hasModule("clients")) return forbidden("Módulo clients no activo");
      const { id, attachmentId } = await params;
      const { ClientAttachment } = tenantModels;

      const row = await ClientAttachment.findOne({
        where: { id: attachmentId, clientId: id },
      });
      if (!row) {
        // Idempotente: no existir es OK.
        return noContent();
      }

      const { storedFilename } = row;
      await row.destroy();
      await deleteAttachmentFile(tenant.slug, id, storedFilename);

      process.stdout.write(
        `[clients:attachment] deleted tenant=${tenant.slug} client=${id} file=${attachmentId}\n`
      );

      return noContent();
    } catch (err) {
      return serverError(err);
    }
  }
);
