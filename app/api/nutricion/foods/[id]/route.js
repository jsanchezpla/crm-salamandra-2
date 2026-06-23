import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import {
  ok,
  error,
  forbidden,
  notFound,
  noContent,
  serverError,
} from "../../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../../lib/db/masterDb.js";
import {
  DEFAULT_UNITS,
  parseNullableDecimal,
  sanitizeMeasures,
  sanitizeTags,
  slugifyName,
} from "../../../../../lib/nutricion/foods.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
// GET /api/nutricion/foods/[id]
// ─────────────────────────────────────────────────────────────────────────────
export const GET = withTenant(async (_request, ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { Food } = tenantModels;
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const row = await Food.findByPk(id);
    if (!row || row.archivedAt) return notFound("Alimento no encontrado");
    return ok(row.toJSON());
  } catch (err) {
    return serverError(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/nutricion/foods/[id] — editar parcial
// ─────────────────────────────────────────────────────────────────────────────
export const PATCH = withTenant(async (request, ctx, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { Food } = tenantModels;
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const row = await Food.findByPk(id);
    if (!row || row.archivedAt) return notFound("Alimento no encontrado");

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body inválido");
    }

    const before = row.toJSON();
    const updates = {};

    if (body.name !== undefined) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (name.length < 2) return error("name debe tener al menos 2 caracteres");
      updates.name = name;
      updates.slug = slugifyName(name);
    }

    if (body.defaultUnit !== undefined) {
      if (!DEFAULT_UNITS.has(body.defaultUnit)) return error("defaultUnit inválido");
      updates.defaultUnit = body.defaultUnit;
    }

    for (const key of ["proteinPer100", "carbsPer100", "fatPer100", "fiberPer100"]) {
      if (body[key] !== undefined) {
        const parsed = parseNullableDecimal(body[key]);
        if (!parsed.ok) return error(`${key}: ${parsed.error}`);
        updates[key] = parsed.value;
      }
    }

    if (body.householdMeasures !== undefined) {
      const measures = sanitizeMeasures(body.householdMeasures);
      if (!measures.ok) return error(measures.error);
      updates.householdMeasures = measures.value ?? [];
    }

    if (body.tags !== undefined) {
      const tags = sanitizeTags(body.tags);
      if (!tags.ok) return error(tags.error);
      updates.tags = tags.value ?? [];
    }

    if (body.barcode !== undefined) {
      const v = typeof body.barcode === "string" ? body.barcode.trim() : "";
      updates.barcode = v || null;
    }

    // Protección de source: si el alimento viene de OpenFoodFacts no se puede
    // pasar a custom y viceversa. La tabla nutricional sí es editable (Laura
    // puede ajustar valores que OFF tenga incompletos o discutibles).
    if (body.source !== undefined && body.source !== row.source) {
      return error("No se puede cambiar el origen (source) de un alimento existente", 422);
    }

    if (Object.keys(updates).length === 0) return ok(row.toJSON());

    await row.update(updates);

    await logAudit({
      tenantId: tenant.id,
      userId,
      action: "nutricion.food.updated",
      entityId: row.id,
      before,
      after: row.toJSON(),
      ip,
    });

    return ok(row.toJSON());
  } catch (err) {
    return serverError(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/nutricion/foods/[id] — soft delete (archivedAt)
// ─────────────────────────────────────────────────────────────────────────────
export const DELETE = withTenant(async (request, ctx, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { Food } = tenantModels;
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const row = await Food.findByPk(id);
    if (!row || row.archivedAt) return notFound("Alimento no encontrado");

    // TODO C2: verificar que el alimento no esté en uso en
    // plan_meal_option_foods. Por ahora se permite siempre (la tabla aún
    // no existe).

    const before = row.toJSON();
    await row.update({ archivedAt: new Date() });

    await logAudit({
      tenantId: tenant.id,
      userId,
      action: "nutricion.food.archived",
      entityId: row.id,
      before,
      after: row.toJSON(),
      ip,
    });

    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
