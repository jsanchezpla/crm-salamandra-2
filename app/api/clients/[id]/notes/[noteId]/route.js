import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { noContent, forbidden, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion, resumen } from "../../../../../../lib/utils/auditoria.js";

/**
 * DELETE /api/clients/[id]/notes/[noteId] — borra una nota.
 * Idempotente: si no existe, devuelve 204.
 *
 * No restringe por autor (Laura es la única usuaria; cualquier admin del
 * tenant puede borrar). Si en el futuro hay más usuarios, esta política
 * se revisará — apuntado al backlog.
 */
export const DELETE = withTenant(
  async (_request, { params }, { tenantModels, hasModule }) => {
    try {
      if (!hasModule("clients")) return forbidden("Módulo clients no activo");
      const { id, noteId } = await params;
      const { ClientNote } = tenantModels;

      const row = await ClientNote.findOne({ where: { id: noteId, clientId: id } });
      if (!row) return noContent();

      await row.destroy();
      process.stdout.write(`[clients:note] deleted client=${id} note=${noteId}\n`);
      return noContent();
    } catch (err) {
      return serverError(err);
    }
  }
);
