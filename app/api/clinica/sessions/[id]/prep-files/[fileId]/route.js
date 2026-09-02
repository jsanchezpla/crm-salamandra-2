import { Readable } from "node:stream";
import { withTenant } from "../../../../../../../lib/tenant/withTenant.js";
import { error, forbidden, notFound, noContent, serverError } from "../../../../../../../lib/utils/apiResponse.js";
import { logClinicaAudit } from "../../../../../../../lib/clinica/audit.js";
import { buscarPrepFile, listaPrepFiles } from "../../../../../../../lib/clinica/prepFiles.js";
import { readDocumentStream, deleteDocumentFile } from "../../../../../../../lib/documents/documentStorage.js";

/**
 * GET    — descarga un adjunto de la preparación de la sesión (por STREAM).
 * DELETE — lo borra (BD y disco).
 *
 * Sprint Aumenta 2026-07, punto 4. Material interno del equipo: gated al módulo
 * Clínica/Pacientes como el resto de la sesión, nunca visible desde el portal.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

async function cargar(ctx, rc) {
  const { id, fileId } = await rc.params;
  if (!UUID_RE.test(id) || !UUID_RE.test(fileId)) return { veto: error("id inválido", 422) };
  const { ClinicSession } = ctx.tenantModels;
  const sesion = await ClinicSession.findByPk(id);
  if (!sesion) return { veto: notFound("Sesión no encontrada") };
  const adjunto = buscarPrepFile(sesion, fileId);
  if (!adjunto) return { veto: notFound("Adjunto no encontrado") };
  return { id, fileId, sesion, adjunto };
}

export const GET = withTenant(async (_request, rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
    const { veto, adjunto } = await cargar(ctx, rc);
    if (veto) return veto;

    let stream;
    let size;
    try {
      ({ stream, size } = await readDocumentStream(ctx.tenant.slug, adjunto.storagePath));
    } catch (err) {
      if (err.code === "ENOENT") return notFound("Archivo físico no encontrado");
      throw err;
    }

    const safeName = String(adjunto.name || "adjunto").replace(/[\r\n"]/g, "_");
    return new Response(Readable.toWeb(stream), {
      status: 200,
      headers: {
        "Content-Type": adjunto.mimeType || "application/octet-stream",
        // `inline`: una foto o un audio se miran/escuchan sin descargarlos.
        "Content-Disposition": `inline; filename="${safeName}"`,
        "Content-Length": String(size),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});

export const DELETE = withTenant(async (request, rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
    const { veto, id, fileId, sesion, adjunto } = await cargar(ctx, rc);
    if (veto) return veto;

    await sesion.update({ prepFiles: listaPrepFiles(sesion).filter((f) => String(f.id) !== String(fileId)) });
    // Y su fila del archivo central, si la tiene (02/09/2026, AV-0027): el
    // fichero es el mismo, así que se va con él. Sin tabla o sin columna (centro
    // sin migrar) no hay fila que quitar.
    try {
      const { Document } = ctx.tenantModels;
      if (Document) await Document.destroy({ where: { clinicSessionId: id, storagePath: adjunto.storagePath } });
    } catch {
      /* sin fila en el archivo */
    }
    await deleteDocumentFile(ctx.tenant.slug, adjunto.storagePath).catch(() => {});

    await logClinicaAudit({
      tenantId: ctx.tenant.id,
      userId: request.headers.get("x-user-id"),
      action: "clinica.session.prep_file_deleted",
      entity: "ClinicSession",
      entityId: id,
      before: { adjunto: adjunto.name, bytes: adjunto.size },
      ip: request.headers.get("x-forwarded-for"),
    });
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
