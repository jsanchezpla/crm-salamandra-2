import { Op, fn, col } from "sequelize";
import { withTenant } from "@/lib/tenant/withTenant.js";
import { ok, created, error, forbidden, unauthorized, serverError } from "@/lib/utils/apiResponse.js";
import { MODULE_KEYS } from "@/lib/tenant/moduleKeys.js";
import {
  logDocumentsAudit,
  resolveOwnerNames,
  whereCarpetasVisibles,
  canCreateInside,
  serializeFolder,
} from "@/lib/documents/helpers.js";
import { carpetasCompartidasCon, contarMiembros } from "@/lib/documents/carpetasCompartidas.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LEVEL = 3; // 0..3 → máximo 4 niveles

// GET /api/documents/folders?visibility=private|shared|all&parentFolderId=<uuid|null>
export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    if (!ctx.hasModule(MODULE_KEYS.DOCUMENTS_AVANZADO)) return forbidden("Módulo documents no activo");
    const userId = request.headers.get("x-user-id");
    if (!userId) return unauthorized();

    const { DocumentFolder, Document } = ctx.tenantModels;
    const sp = new URL(request.url).searchParams;
    const visibility = ["private", "shared", "all"].includes(sp.get("visibility")) ? sp.get("visibility") : "all";

    /*
     * Lo que le han compartido a quien mira (01/09/2026). `todas` incluye las
     * subcarpetas de lo compartido: compartir «Protocolos» y que dentro no se
     * vea nada sería compartir un cartel.
     */
    const { directas, todas } = await carpetasCompartidasCon({ tenantModels: ctx.tenantModels, userId });

    const base = whereCarpetasVisibles(userId, visibility, todas);
    // Navegación por nivel: sin parentFolderId (o "null") → raíz.
    const parentParam = sp.get("parentFolderId");
    const enRaiz = !(parentParam && parentParam !== "null");
    if (!enRaiz && !UUID_RE.test(parentParam)) return error("parentFolderId inválido", 400);

    /*
     * UNA CARPETA COMPARTIDA APARECE EN LA RAÍZ de quien la recibe, aunque por
     * dentro cuelgue de otra: para llegar a ella por el camino normal habría
     * que poder abrir a su madre, que no ve. Solo se sube a la raíz cuando esa
     * madre NO le es visible; si puede abrirla, la carpeta ya sale dentro y
     * ponerla también arriba la enseñaría dos veces.
     */
    let subenALaRaiz = [];
    if (enRaiz && directas.length) {
      const cands = await DocumentFolder.findAll({
        where: { id: directas },
        attributes: ["id", "parentFolderId"],
        raw: true,
      });
      const padres = [...new Set(cands.map((c) => c.parentFolderId).filter(Boolean))];
      const filasPadre = padres.length
        ? await DocumentFolder.findAll({
            where: { id: padres },
            attributes: ["id", "visibility", "ownerUserId"],
            raw: true,
          })
        : [];
      const compartidas = new Set(todas);
      const padreVisible = new Map(
        filasPadre.map((p) => [p.id, p.visibility === "shared" || p.ownerUserId === userId || compartidas.has(p.id)])
      );
      subenALaRaiz = cands
        .filter((c) => c.parentFolderId && !padreVisible.get(c.parentFolderId))
        .map((c) => c.id);
    }

    const enSuSitio = { [Op.and]: [base, { parentFolderId: enRaiz ? null : parentParam }] };
    const where = subenALaRaiz.length
      ? { [Op.or]: [enSuSitio, { id: { [Op.in]: subenALaRaiz } }] }
      : enSuSitio;

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
    // Con cuánta gente está compartida cada una, para poder decirlo en la ficha
    // de la carpeta sin abrirla. Una consulta para toda la lista.
    const compartidasCon = await contarMiembros({ tenantModels: ctx.tenantModels, folderIds: ids });
    const mias = new Set(todas);
    const folders = rows.map((f) =>
      serializeFolder(f, names.get(f.ownerUserId), {
        documentCount: docCounts.get(f.id) ?? 0,
        subfolderCount: subCounts.get(f.id) ?? 0,
        sharedWith: compartidasCon.get(f.id) ?? 0,
        // «Me la han pasado»: ni es mía ni es de todo el centro.
        compartidaConmigo: f.ownerUserId !== userId && f.visibility !== "shared" && mias.has(f.id),
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
    if (!ctx.hasModule(MODULE_KEYS.DOCUMENTS_AVANZADO)) return forbidden("Módulo documents no activo");
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
