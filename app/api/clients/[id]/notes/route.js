import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import {
  ok,
  created,
  error,
  forbidden,
  notFound,
  serverError,
} from "../../../../../lib/utils/apiResponse.js";

const MAX_PAGE_SIZE = 50;

/**
 * GET /api/clients/[id]/notes — timeline de notas internas.
 * Orden DESC por createdAt. Paginación: ?page=1&limit=50 (max 50).
 */
export const GET = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("clients")) return forbidden("Módulo clients no activo");
    const { id } = await params;
    const { Client, ClientNote } = tenantModels;

    const client = await Client.findByPk(id, { attributes: ["id"] });
    if (!client) return notFound("Cliente no encontrado");

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));
    const offset = (page - 1) * limit;

    const { count, rows } = await ClientNote.findAndCountAll({
      where: { clientId: id },
      order: [["createdAt", "DESC"]],
      limit,
      offset,
    });

    return ok({
      notes: rows.map((r) => r.toJSON()),
      total: count,
      page,
      limit,
    });
  } catch (err) {
    return serverError(err);
  }
});

/**
 * POST /api/clients/[id]/notes — crea nota.
 * Body: { content: string (no vacío) }
 * createdBy se autocompleta desde X-User-Email si está presente.
 */
export const POST = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("clients")) return forbidden("Módulo clients no activo");
    const { id } = await params;
    const { Client, ClientNote } = tenantModels;
    const createdBy = request.headers.get("x-user-email") ?? null;

    const client = await Client.findByPk(id, { attributes: ["id"] });
    if (!client) return notFound("Cliente no encontrado");

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) return error("content es obligatorio", 422);

    const row = await ClientNote.create({
      clientId: id,
      content,
      createdBy,
    });

    process.stdout.write(`[clients:note] created tenant client=${id} note=${row.id}\n`);

    return created(row.toJSON());
  } catch (err) {
    return serverError(err);
  }
});
