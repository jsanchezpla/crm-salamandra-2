import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import {
  ok,
  noContent,
  error,
  forbidden,
  notFound,
  serverError,
} from "../../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion, resumen } from "../../../../../../lib/utils/auditoria.js";

/**
 * PATCH /api/clients/[id]/notes/[noteId] — corrige el texto de una entrada.
 * Body: { content: string (no vacío) }
 *
 * Nació el 04/09/2026 con AV-0040 de Laura: en Historia clínica solo había
 * «Borrar», así que una errata obligaba a tirar la entrada entera y volver a
 * escribirla, perdiendo la fecha original. Ahora se corrige en su sitio y la
 * entrada conserva su `createdAt`; lo que cambia es `updatedAt`, y de ahí sale
 * el «(editada)» que el panel enseña — en una historia clínica hay que poder
 * ver que una anotación se ha tocado.
 *
 * Quién puede: los mismos que pueden borrar (cualquiera del tenant que llegue
 * a la ficha). Sin restricción por autor, igual que el DELETE de abajo: si un
 * día hay que restringir, se restringen las dos a la vez.
 */
export const PATCH = withTenant(
  async (request, { params }, { tenant, tenantModels, hasModule }) => {
    try {
      if (!hasModule("clients")) return forbidden("Módulo clients no activo");
      const { id, noteId } = await params;
      const { ClientNote } = tenantModels;

      let body;
      try { body = await request.json(); } catch { return error("Body inválido"); }

      const content = typeof body.content === "string" ? body.content.trim() : "";
      if (!content) return error("content es obligatorio", 422);

      // Acotado por clientId: una nota de OTRA ficha no se edita desde aquí
      // aunque se acierte el id.
      const row = await ClientNote.findOne({ where: { id: noteId, clientId: id } });
      if (!row) return notFound("Nota no encontrada");

      await row.update({ content });

      // Ni el texto viejo ni el nuevo entran en la auditoría (datos de salud
      // en master.audit_logs, que comparten todos los clientes): queda quién,
      // cuándo y de qué ficha, que es lo que sirve para rastrearlo.
      await auditar({
        tenantId: tenant.id,
        ...datosPeticion(request),
        action: "client.note.updated",
        entity: "ClientNote",
        entityId: noteId,
        after: resumen(row, ["clientId", "createdBy"]),
      });
      process.stdout.write(`[clients:note] updated client=${id} note=${noteId}\n`);

      return ok(row.toJSON());
    } catch (err) {
      return serverError(err);
    }
  }
);

/**
 * DELETE /api/clients/[id]/notes/[noteId] — borra una nota.
 * Idempotente: si no existe, devuelve 204.
 *
 * No restringe por autor (Laura es la única usuaria; cualquier admin del
 * tenant puede borrar). Si en el futuro hay más usuarios, esta política
 * se revisará — apuntado al backlog.
 */
export const DELETE = withTenant(
  async (request, { params }, { tenant, tenantModels, hasModule }) => {
    try {
      if (!hasModule("clients")) return forbidden("Módulo clients no activo");
      const { id, noteId } = await params;
      const { ClientNote } = tenantModels;

      const row = await ClientNote.findOne({ where: { id: noteId, clientId: id } });
      if (!row) return noContent();

      // El CONTENIDO de la nota no entra en la auditoría: en un CRM con
      // pacientes ahí hay datos de salud, y master.audit_logs lo comparten
      // todos los clientes. Con el cliente y el autor basta para rastrearlo.
      const antesBorrar = resumen(row, ["clientId", "createdBy"]);
      await row.destroy();
      await auditar({
        tenantId: tenant.id,
        ...datosPeticion(request),
        action: "client.note.deleted",
        entity: "ClientNote",
        entityId: noteId,
        before: antesBorrar,
      });
      process.stdout.write(`[clients:note] deleted client=${id} note=${noteId}\n`);
      return noContent();
    } catch (err) {
      return serverError(err);
    }
  }
);
