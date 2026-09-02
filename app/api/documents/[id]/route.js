import { withTenant } from "@/lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, unauthorized, noContent, serverError } from "@/lib/utils/apiResponse.js";
import { MODULE_KEYS } from "@/lib/tenant/moduleKeys.js";
import { logDocumentsAudit, resolveOwnerNames, canViewDocument, serializeDocument } from "@/lib/documents/helpers.js";
import { carpetasCompartidasCon } from "@/lib/documents/carpetasCompartidas.js";
import { deleteDocumentFile } from "@/lib/documents/documentStorage.js";
import { esAdjuntoDePreparacion } from "@/lib/clinica/prepFiles.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/documents/[id] — metadatos.
export const GET = withTenant(async (request, { params }, ctx) => {
  try {
    if (!ctx.hasModule(MODULE_KEYS.DOCUMENTS_AVANZADO)) return forbidden("Módulo documents no activo");
    const userId = request.headers.get("x-user-id");
    if (!userId) return unauthorized();
    const { id } = await params;
    if (!UUID_RE.test(id)) return error("id inválido", 400);

    const { Document } = ctx.tenantModels;
    const doc = await Document.findByPk(id);
    if (!doc) return notFound("Documento no encontrado");
    // Se ve lo de siempre y, además, lo que vive en una carpeta compartida
    // conmigo (01/09/2026). El borrado de abajo NO cambia: sigue siendo del dueño.
    const { todas } = await carpetasCompartidasCon({ tenantModels: ctx.tenantModels, userId });
    if (!canViewDocument(doc, userId, todas)) return forbidden("Sin acceso a este documento");

    const names = await resolveOwnerNames([doc.ownerUserId]);
    return ok(serializeDocument(doc, names.get(doc.ownerUserId)));
  } catch (err) {
    return serverError(err);
  }
});

// DELETE /api/documents/[id] — solo owner. Borra archivo físico + fila BD.
export const DELETE = withTenant(async (request, { params }, ctx) => {
  try {
    if (!ctx.hasModule(MODULE_KEYS.DOCUMENTS_AVANZADO)) return forbidden("Módulo documents no activo");
    const userId = request.headers.get("x-user-id");
    if (!userId) return unauthorized();
    const { id } = await params;
    if (!UUID_RE.test(id)) return error("id inválido", 400);

    const { Document } = ctx.tenantModels;
    const doc = await Document.findByPk(id);
    if (!doc) return notFound("Documento no encontrado");
    // Un adjunto de la preparación de una sesión se quita desde su sesión
    // (02/09/2026, AV-0027): borrarlo aquí dejaría el registro apuntando a un
    // fichero que ya no está.
    if (esAdjuntoDePreparacion(doc)) {
      return error("Este adjunto es de la preparación de una sesión: se quita desde el registro de la sesión.", 409);
    }
    if (doc.ownerUserId !== userId) return forbidden("Solo el propietario puede borrar el documento");

    const storagePath = doc.storagePath;
    const before = { fileName: doc.fileName, visibility: doc.visibility, fileSize: Number(doc.fileSize) };

    await ctx.tenantSequelize.transaction(async (t) => {
      await doc.destroy({ transaction: t });
    });
    // Borrado físico best-effort tras el commit de BD.
    await deleteDocumentFile(ctx.slug, storagePath);

    await logDocumentsAudit({
      tenantId: ctx.tenant.id,
      userId,
      action: "document.deleted",
      entity: "Document",
      entityId: id,
      before,
      after: null,
      ip: request.headers.get("x-forwarded-for"),
    });

    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
