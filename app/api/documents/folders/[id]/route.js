import { Op } from "sequelize";
import { withTenant } from "@/lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, unauthorized, noContent, serverError } from "@/lib/utils/apiResponse.js";
import { MODULE_KEYS } from "@/lib/tenant/moduleKeys.js";
import { logDocumentsAudit, resolveOwnerNames, canViewFolder, serializeFolder } from "@/lib/documents/helpers.js";
import { carpetasCompartidasCon, contarMiembros } from "@/lib/documents/carpetasCompartidas.js";
import { deleteDocumentFile } from "@/lib/documents/documentStorage.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Recolecta el id de la carpeta y de todas sus descendientes (máx 4 niveles).
async function collectSubtreeIds(DocumentFolder, rootId) {
  const ids = [rootId];
  let frontier = [rootId];
  for (let depth = 0; depth < 4 && frontier.length; depth++) {
    const children = await DocumentFolder.findAll({
      where: { parentFolderId: frontier },
      attributes: ["id"],
      raw: true,
    });
    frontier = children.map((c) => c.id);
    ids.push(...frontier);
  }
  return ids;
}

// GET /api/documents/folders/[id] — detalle + breadcrumb (raíz → actual).
export const GET = withTenant(async (request, { params }, ctx) => {
  try {
    if (!ctx.hasModule(MODULE_KEYS.DOCUMENTS_AVANZADO)) return forbidden("Módulo documents no activo");
    const userId = request.headers.get("x-user-id");
    if (!userId) return unauthorized();
    const { id } = await params;
    if (!UUID_RE.test(id)) return error("id inválido", 400);

    const { DocumentFolder } = ctx.tenantModels;
    const folder = await DocumentFolder.findByPk(id);
    if (!folder) return notFound("Carpeta no encontrada");
    // También la ve quien esté en su lista, o en la de alguna de sus madres
    // (01/09/2026). Renombrar y borrar siguen siendo del dueño, más abajo.
    const { todas } = await carpetasCompartidasCon({ tenantModels: ctx.tenantModels, userId });
    if (!canViewFolder(folder, userId, todas)) return forbidden("Sin acceso a esta carpeta");

    /*
     * Breadcrumb subiendo por parentFolderId (acotado por la profundidad
     * máxima). Se CORTA en cuanto una madre deja de ser visible (01/09/2026):
     * desde que una carpeta puede compartirse suelta, a quien le pasan
     * «Protocolos/2026» no tiene por qué enterarse de cómo se llama la carpeta
     * privada de otro en la que vive. Antes no pasaba porque una carpeta
     * privada solo la veía su dueño, que ve toda su rama.
     */
    const chain = [folder];
    let cur = folder;
    for (let i = 0; i < 4 && cur.parentFolderId; i++) {
      cur = await DocumentFolder.findByPk(cur.parentFolderId);
      if (!cur || !canViewFolder(cur, userId, todas)) break;
      chain.unshift(cur);
    }

    const names = await resolveOwnerNames([folder.ownerUserId]);
    const compartidasCon = await contarMiembros({ tenantModels: ctx.tenantModels, folderIds: [folder.id] });
    return ok({
      folder: serializeFolder(folder, names.get(folder.ownerUserId), {
        sharedWith: compartidasCon.get(folder.id) ?? 0,
        compartidaConmigo: folder.ownerUserId !== userId && folder.visibility !== "shared" && todas.includes(folder.id),
      }),
      breadcrumb: chain.map((f) => ({ id: f.id, name: f.name })),
    });
  } catch (err) {
    return serverError(err);
  }
});

// PATCH /api/documents/folders/[id] — renombrar (solo el owner).
export const PATCH = withTenant(async (request, { params }, ctx) => {
  try {
    if (!ctx.hasModule(MODULE_KEYS.DOCUMENTS_AVANZADO)) return forbidden("Módulo documents no activo");
    const userId = request.headers.get("x-user-id");
    if (!userId) return unauthorized();
    const { id } = await params;
    if (!UUID_RE.test(id)) return error("id inválido", 400);

    const { DocumentFolder } = ctx.tenantModels;
    const folder = await DocumentFolder.findByPk(id);
    if (!folder) return notFound("Carpeta no encontrada");
    if (folder.ownerUserId !== userId) return forbidden("Solo el propietario puede renombrar la carpeta");

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body inválido", 400);
    }
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 255) return error("El nombre es obligatorio (1-255)", 400);

    const dup = await DocumentFolder.findOne({
      where: {
        parentFolderId: folder.parentFolderId,
        name,
        visibility: folder.visibility,
        ownerUserId: userId,
      },
      attributes: ["id"],
    });
    if (dup && dup.id !== folder.id) return error("Ya existe una carpeta con ese nombre en este nivel", 409);

    const before = { name: folder.name };
    await folder.update({ name });

    await logDocumentsAudit({
      tenantId: ctx.tenant.id,
      userId,
      action: "document_folder.updated",
      entity: "DocumentFolder",
      entityId: folder.id,
      before,
      after: { name },
      ip: request.headers.get("x-forwarded-for"),
    });

    const names = await resolveOwnerNames([folder.ownerUserId]);
    return ok(serializeFolder(folder, names.get(folder.ownerUserId)));
  } catch (err) {
    return serverError(err);
  }
});

// DELETE /api/documents/folders/[id] — solo owner. CASCADE (subcarpetas + docs
// en BD por FK) + borrado FÍSICO de todos los archivos del subárbol.
export const DELETE = withTenant(async (request, { params }, ctx) => {
  try {
    if (!ctx.hasModule(MODULE_KEYS.DOCUMENTS_AVANZADO)) return forbidden("Módulo documents no activo");
    const userId = request.headers.get("x-user-id");
    if (!userId) return unauthorized();
    const { id } = await params;
    if (!UUID_RE.test(id)) return error("id inválido", 400);

    const { DocumentFolder, Document } = ctx.tenantModels;
    const folder = await DocumentFolder.findByPk(id);
    if (!folder) return notFound("Carpeta no encontrada");
    if (folder.ownerUserId !== userId) return forbidden("Solo el propietario puede borrar la carpeta");

    // Recolectar los archivos físicos del subárbol ANTES de borrar (la FK
    // CASCADE elimina filas en BD pero no toca disco).
    const subtreeIds = await collectSubtreeIds(DocumentFolder, folder.id);
    const docs = await Document.findAll({
      where: { folderId: subtreeIds },
      attributes: ["id", "storagePath"],
      raw: true,
    });

    // Protección cross-usuario: en carpetas shared cualquiera del tenant sube, y
    // el borrado de un documento/carpeta es SOLO de su propietario. Si el subárbol
    // contiene elementos de otros usuarios, no se puede borrar (evita perder sus
    // archivos vía CASCADE). Las carpetas private son mono-propietario, así que
    // esto solo afecta a shared.
    const [foreignDocs, foreignFolders] = await Promise.all([
      Document.count({ where: { folderId: subtreeIds, ownerUserId: { [Op.ne]: userId } } }),
      DocumentFolder.count({ where: { id: subtreeIds, ownerUserId: { [Op.ne]: userId } } }),
    ]);
    if (foreignDocs > 0 || foreignFolders > 0) {
      return error("La carpeta contiene elementos de otros usuarios; pídeles que los quiten antes de borrarla.", 409);
    }

    // Borrado en BD dentro de transacción (Postgres cascada por la FK).
    await ctx.tenantSequelize.transaction(async (t) => {
      await folder.destroy({ transaction: t });
    });

    // Borrado físico best-effort tras el commit.
    for (const d of docs) {
      await deleteDocumentFile(ctx.slug, d.storagePath);
    }

    await logDocumentsAudit({
      tenantId: ctx.tenant.id,
      userId,
      action: "document_folder.deleted",
      entity: "DocumentFolder",
      entityId: folder.id,
      before: { name: folder.name, visibility: folder.visibility, subfolders: subtreeIds.length - 1, files: docs.length },
      after: null,
      ip: request.headers.get("x-forwarded-for"),
    });

    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
