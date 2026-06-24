import { Op } from "sequelize";
import { NextResponse } from "next/server";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import {
  created,
  error,
  forbidden,
  serverError,
} from "../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../lib/db/masterDb.js";

const MAX_LIMIT = 100;

async function logAudit({ tenantId, userId, action, entityId, before, after, ip }) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create({
      tenantId,
      userId,
      action,
      entity: "Plan",
      entityId,
      before,
      after,
      ip,
    });
  } catch { /* silent */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/nutricion/plans — lista paginada (solo metadata, sin árbol)
// ─────────────────────────────────────────────────────────────────────────────
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { Plan } = tenantModels;
    const { searchParams } = new URL(request.url);

    const type = (searchParams.get("type") ?? "").trim();
    if (type !== "template" && type !== "assigned") {
      return error("type requerido (template | assigned)");
    }

    const q = (searchParams.get("q") ?? "").trim();
    const clientId = (searchParams.get("clientId") ?? "").trim();
    const includeArchived = searchParams.get("includeArchived") === "true";

    let limit = parseInt(searchParams.get("limit") ?? "50", 10);
    if (!Number.isInteger(limit) || limit <= 0) limit = 50;
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;
    let page = parseInt(searchParams.get("page") ?? "1", 10);
    if (!Number.isInteger(page) || page <= 0) page = 1;
    const offset = (page - 1) * limit;

    const where = { type };
    if (!includeArchived) where.archivedAt = null;
    if (q) where.name = { [Op.iLike]: `%${q}%` };
    if (type === "assigned" && clientId) where.clientId = clientId;

    const { rows, count } = await Plan.findAndCountAll({
      where,
      limit,
      offset,
      order: [["updatedAt", "DESC"]],
    });

    return NextResponse.json({
      ok: true,
      items: rows.map((r) => r.toJSON()),
      total: count,
      page,
      limit,
    });
  } catch (err) {
    return serverError(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/nutricion/plans — crear plantilla VACÍA (sin meals)
// ─────────────────────────────────────────────────────────────────────────────
export const POST = withTenant(async (request, _ctx, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { Plan } = tenantModels;
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 2) return error("name requerido (mínimo 2 caracteres)");
    const description = body.description === undefined || body.description === null
      ? null
      : String(body.description).slice(0, 10000);

    const row = await Plan.create({
      name,
      description,
      type: "template",
      visibleToClient: false,
      // templateId, clientId, assignedAt todos NULL → satisface CHECK
    });

    await logAudit({
      tenantId: tenant.id,
      userId,
      action: "nutricion.plan.created",
      entityId: row.id,
      before: null,
      after: row.toJSON(),
      ip,
    });

    return created(row.toJSON());
  } catch (err) {
    return serverError(err);
  }
});
