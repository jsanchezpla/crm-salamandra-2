import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import {
  ok,
  created,
  error,
  forbidden,
  serverError,
} from "../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import {
  HOUSEHOLD_MEASURES_SEED,
  DEFAULT_UNITS,
  slugifyName,
  parseNullableDecimal,
  sanitizeMeasures,
  sanitizeTags,
} from "../../../../lib/nutricion/foods.js";
import { NextResponse } from "next/server";

const MAX_LIMIT = 100;

async function logAudit({ tenantId, userId, action, entityId, before, after, ip }) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create({
      tenantId,
      userId,
      action,
      entity: "Food",
      entityId,
      before,
      after,
      ip,
    });
  } catch {
    /* silent */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/nutricion/foods — listar alimentos del catálogo local
// ─────────────────────────────────────────────────────────────────────────────
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { Food } = tenantModels;
    const { searchParams } = new URL(request.url);

    const q = (searchParams.get("q") ?? "").trim();
    const tag = (searchParams.get("tag") ?? "").trim();
    const source = (searchParams.get("source") ?? "").trim();
    let limit = parseInt(searchParams.get("limit") ?? "50", 10);
    if (!Number.isInteger(limit) || limit <= 0) limit = 50;
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;
    let page = parseInt(searchParams.get("page") ?? "1", 10);
    if (!Number.isInteger(page) || page <= 0) page = 1;
    const offset = (page - 1) * limit;

    const where = { archivedAt: null };
    if (q) where.name = { [Op.iLike]: `%${q}%` };
    if (tag) where.tags = { [Op.contains]: [tag] };
    if (source === "openfoodfacts" || source === "custom") where.source = source;

    const { rows, count } = await Food.findAndCountAll({
      where,
      limit,
      offset,
      order: [["name", "ASC"]],
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
// POST /api/nutricion/foods — crear alimento manual
// ─────────────────────────────────────────────────────────────────────────────
export const POST = withTenant(async (request, _ctx, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { Food } = tenantModels;
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body inválido");
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 2) return error("name requerido (mínimo 2 caracteres)");

    const defaultUnit = body.defaultUnit ?? "g";
    if (!DEFAULT_UNITS.has(defaultUnit)) {
      return error("defaultUnit inválido (g | ml | unidad)");
    }

    const macros = {};
    for (const key of ["proteinPer100", "carbsPer100", "fatPer100", "fiberPer100"]) {
      const parsed = parseNullableDecimal(body[key]);
      if (!parsed.ok) return error(`${key}: ${parsed.error}`);
      macros[key] = parsed.value;
    }

    const measures = sanitizeMeasures(body.householdMeasures);
    if (!measures.ok) return error(measures.error);
    const householdMeasures =
      measures.value === undefined || measures.value.length === 0
        ? [...HOUSEHOLD_MEASURES_SEED]
        : measures.value;

    const tags = sanitizeTags(body.tags);
    if (!tags.ok) return error(tags.error);

    const barcode =
      typeof body.barcode === "string" && body.barcode.trim() ? body.barcode.trim() : null;

    const row = await Food.create({
      name,
      slug: slugifyName(name),
      defaultUnit,
      ...macros,
      householdMeasures,
      source: "custom",
      externalId: null,
      barcode,
      tags: tags.value ?? [],
    });

    await logAudit({
      tenantId: tenant.id,
      userId,
      action: "nutricion.food.created",
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
