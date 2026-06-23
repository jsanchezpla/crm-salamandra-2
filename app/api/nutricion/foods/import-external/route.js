import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import {
  ok,
  created,
  error,
  forbidden,
  notFound,
  serverError,
} from "../../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../../lib/db/masterDb.js";
import {
  HOUSEHOLD_MEASURES_SEED,
  fetchOpenFoodFactsByCode,
  slugifyName,
} from "../../../../../lib/nutricion/foods.js";

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
// POST /api/nutricion/foods/import-external
// Body: { external_id }
// Importa un alimento de OpenFoodFacts al catálogo local. Idempotente:
// si ya existe un alimento con ese external_id, lo devuelve sin duplicar.
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
    const externalId =
      typeof body.external_id === "string" && body.external_id.trim()
        ? body.external_id.trim()
        : null;
    if (!externalId) return error("external_id requerido");

    // ── Idempotencia: ¿ya está en el catálogo local? ─────────────────────
    const existing = await Food.findOne({ where: { externalId, archivedAt: null } });
    if (existing) {
      return ok(existing.toJSON());
    }

    // ── Buscar en OpenFoodFacts ──────────────────────────────────────────
    const { item, external_error } = await fetchOpenFoodFactsByCode(externalId);
    if (external_error) {
      return error("OpenFoodFacts no disponible", 502);
    }
    if (!item) {
      return notFound("Alimento no encontrado en OpenFoodFacts");
    }

    const name = item.name || `OFF ${externalId}`;

    const row = await Food.create({
      name,
      slug: slugifyName(name),
      defaultUnit: "g",
      proteinPer100: item.protein_per_100,
      carbsPer100: item.carbs_per_100,
      fatPer100: item.fat_per_100,
      fiberPer100: item.fiber_per_100,
      householdMeasures: [...HOUSEHOLD_MEASURES_SEED],
      source: "openfoodfacts",
      externalId,
      barcode: externalId,
      tags: [],
    });

    await logAudit({
      tenantId: tenant.id,
      userId,
      action: "nutricion.food.imported_from_off",
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
