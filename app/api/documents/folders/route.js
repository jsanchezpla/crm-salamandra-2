import { fn, col } from "sequelize";
import { withTenant } from "@/lib/tenant/withTenant.js";
import { ok, created, error, forbidden, unauthorized, serverError } from "@/lib/utils/apiResponse.js";
import { MODULE_KEYS } from "@/lib/tenant/moduleKeys.js";
import {
  logDocumentsAudit,
  resolveOwnerNames,
  visibilityWhere,
  canCreateInside,
  serializeFolder,
} from "@/lib/documents/helpers.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LEVEL = 3; // 0..3 → máximo 4 niveles

// GET /api/documents/folders?visibility=private|shared|all&parentFolderId=<uuid|null>
export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    if (!ctx.hasModule(MODULE_KEYS.DOCUMENTS)) return forbidden("Módulo documents no activo");
    const userId = request.headers.get("x-user-id");
    if (!userId) return unauthorized();

    const { DocumentFolder, Document } = ctx.tenantModels;
    const sp = new URL(request.url).searchParams;
    const visibility = ["private", "shared", "all"].includes(sp.get("visibility")) ? sp.get("visibility") : "all";

    const where = visibilityWhere(userId, visibility);
    // Navegación por nivel: sin parentFolderId (o "null") → raíz.
    const parentParam = sp.get("parentFolderId");
    if (parentParam && parentParam !== "null") {
      if (!UUID_RE.test(parentParam)) return error("parentFolderId inválido", 400);
      where.parentFolderId = parentParam;
    } else {
      where.parentFolderId = null;
    }

    const rows = await DocumentFolder.findAll({ where, order: [["name", "ASC"]], limit: 1000 });
    const ids = rows.map((r) => r.id);

    // Conteos agregados (evita N+1). Todos los hijos/docs de una carpeta comparten
    // su visibilidad, así que contar todos es correcto para quien ve la carpeta.
    let docCounts = new Map();
    let subCounts = new Map();
    if (ids.length) {
      const dc = await Document.findAll({
        attributes: ["folderId", [fn("COUNT", col("id")), "n"]],
        where: { folderId: ids },
        group: ["folderId"],
        raw: true,
      });
      docCounts = new Map(dc.map((r) => [r.folderId, Number(r.n)]));
      const sc = await DocumentFolder.findAll({
        attributes: ["parentFolderId", [fn("COUNT", col("id")), "n"]],
        where: { parentFolderId: ids },
        group: ["parentFolderId"],
        raw: true,
      });
      subCounts = new Map(sc.map((r) => [r.parentFolderId, Number(r.n)]));
    }

    const names = await resolveOwnerNames(rows.map((r) => r.ownerUserId));
    const folders = rows.map((f) =>
      serializeFolder(f, names.get(f.ownerUserId), {
        documentCount: docCounts.get(f.id) ?? 0,
        subfolderCount: subCounts.get(f.id) ?? 0,
      })
    );
    return ok({ folders });
  } catch (err) {
    return serverError(err);
  }
});

// POST /api/documents/folders  { name, visibility, parentFolderId? }
export const POST = withTenant(async (request, _rc, ctx) => {
  try {
    if (!ctx.hasModule(MODULE_KEYS.DOCUMENTS)) return forbidden("Módulo documents no activo");
    const userId = request.headers.get("x-user-id");
    if (!userId) return unauthorized();

    const { DocumentFolder } = ctx.tenantModels;
    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body inválido", 400);
    }

    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const visibility = body?.visibility;
    const parentFolderId = body?.parentFolderId ?? null;

    if (!name || name.length > 255) return error("El nombre es obligatorio (1-255)", 400);
    if (!["private", "shared"].includes(visibility)) return error("visibility debe ser 'private' o 'shared'", 400);

    let level = 0;
    if (parentFolderId != null) {
      if (!UUID_RE.test(parentFolderId)) return error("parentFolderId inválido", 400);
      const parent = await DocumentFolder.findByPk(parentFolderId);
      if (!parent) return error("La carpeta padre no existe", 404);
      if (!canCreateInside(parent, userId)) return forbidden("Sin acceso a la carpeta padre");
      if (parent.visibility !== visibility) {
        return error("La visibilidad debe coincidir con la de la carpeta padre", 400);
      }
      level = parent.level + 1;
      if (level > MAX_LEVEL) return error("Máximo 4 niveles de carpetas", 400);
    }

    // Dedup por (parent, name, visibility, owner). Cubre también la raíz
    // (parent NULL), donde el índice UNIQUE de Postgres no lo garantiza.
    const dup = await DocumentFolder.findOne({
      where: { parentFolderId, name, visibility, ownerUserId: userId },
      attributes: ["id"],
    });
    if (dup) return error("Ya existe una carpeta con ese nombre en este nivel", 409);

    const folder = await DocumentFolder.create({ parentFolderId, visibility, ownerUserId: userId, name, level });

    await logDocumentsAudit({
      tenantId: ctx.tenant.id,
      userId,
      action: "document_folder.created",
      entity: "DocumentFolder",
      entityId: folder.id,
      before: null,
      after: { name, visibility, parentFolderId, level },
      ip: request.headers.get("x-forwarded-for"),
    });

    return created(serializeFolder(folder, null, { documentCount: 0, subfolderCount: 0 }));
  } catch (err) {
    return serverError(err);
  }
});
