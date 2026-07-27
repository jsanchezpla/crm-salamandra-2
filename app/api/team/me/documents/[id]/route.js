import { Readable } from "node:stream";
import { withTenant } from "@/lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, unauthorized, serverError } from "@/lib/utils/apiResponse.js";
import { contentDisposition } from "@/lib/documents/helpers.js";
import { readDocumentStream, deleteDocumentFile } from "@/lib/documents/documentStorage.js";

/**
 * /api/team/me/documents/[id] — descargar o borrar un documento PERSONAL propio.
 * Acota SIEMPRE al dueño (ownerUserId) y a source "equipo", así que un usuario
 * nunca alcanza documentos de otro ni del archivo general. Independiente del
 * módulo `documents`.
 */
const SOURCE = "equipo";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function teamGate(ctx) {
  const has = ctx.tenantHasModule ? ctx.tenantHasModule.bind(ctx) : ctx.hasModule.bind(ctx);
  return has("team") || has("clinica");
}

async function ownDoc(ctx, userId, id) {
  const { Document } = ctx.tenantModels;
  if (!Document) return null;
  const doc = await Document.findByPk(id);
  if (!doc || doc.ownerUserId !== userId || doc.source !== SOURCE) return null;
  return doc;
}

// GET — descarga por stream (attachment).
export const GET = withTenant(async (request, { params }, ctx) => {
  try {
    if (!teamGate(ctx)) return forbidden("Módulo equipo no activo");
    const userId = request.headers.get("x-user-id");
    if (!userId) return unauthorized();
    const { id } = await params;
    if (!UUID_RE.test(id)) return error("id inválido", 400);
    const doc = await ownDoc(ctx, userId, id);
    if (!doc) return notFound("Documento no encontrado");

    let stream, size;
    try {
      ({ stream, size } = await readDocumentStream(ctx.slug, doc.storagePath));
    } catch (e) {
      if (e.code === "ENOENT") return notFound("Archivo físico no encontrado");
      throw e;
    }
    return new Response(Readable.toWeb(stream), {
      status: 200,
      headers: {
        "Content-Type": doc.mimeType,
        "Content-Disposition": contentDisposition("attachment", doc.fileName),
        "Content-Length": String(size),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});

// DELETE — borra el documento propio (fila + fichero físico).
export const DELETE = withTenant(async (request, { params }, ctx) => {
  try {
    if (!teamGate(ctx)) return forbidden("Módulo equipo no activo");
    const userId = request.headers.get("x-user-id");
    if (!userId) return unauthorized();
    const { id } = await params;
    if (!UUID_RE.test(id)) return error("id inválido", 400);
    const doc = await ownDoc(ctx, userId, id);
    if (!doc) return notFound("Documento no encontrado");

    const storagePath = doc.storagePath;
    await doc.destroy();
    await deleteDocumentFile(ctx.slug, storagePath).catch(() => {});
    return ok({ deleted: true });
  } catch (err) {
    return serverError(err);
  }
});
