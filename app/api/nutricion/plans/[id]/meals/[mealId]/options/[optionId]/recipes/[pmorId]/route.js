import { withTenant } from "../../../../../../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, noContent, serverError } from "../../../../../../../../../../../lib/utils/apiResponse.js";
import {
  assertMealBelongsToPlan,
  assertOptionBelongsToMeal,
  assertRecipeBelongsToOption,
} from "../../../../../../../../../../../lib/nutricion/plans.js";

async function resolve(ctx, tenantModels) {
  const { id: planId, mealId, optionId, pmorId } = await ctx.params;
  const { PlanMeal, PlanMealOption, PlanMealOptionRecipe } = tenantModels;
  await assertMealBelongsToPlan(PlanMeal, planId, mealId);
  await assertOptionBelongsToMeal(PlanMealOption, mealId, optionId);
  const row = await assertRecipeBelongsToOption(PlanMealOptionRecipe, optionId, pmorId);
  return row;
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH .../recipes/[pmorId] — editar servings / ordering / nombre del snapshot
// ─────────────────────────────────────────────────────────────────────────────
export const PATCH = withTenant(async (request, ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    let row;
    try {
      row = await resolve(ctx, tenantModels);
    } catch (e) {
      if (e.code === "not_found") return notFound(e.message);
      return error(e.message);
    }

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const updates = {};
    if (body.servings !== undefined) {
      const s = Number(body.servings);
      if (!Number.isFinite(s) || s <= 0 || s > 100) return error("servings inválido (número > 0)");
      updates.servings = Math.round(s * 100) / 100;
    }
    if (body.ordering !== undefined) {
      const o = Number(body.ordering);
      if (!Number.isInteger(o) || o < 0) return error("ordering inválido");
      updates.ordering = o;
    }
    if (body.nameSnapshot !== undefined) {
      const n = typeof body.nameSnapshot === "string" ? body.nameSnapshot.trim() : "";
      if (n.length < 1 || n.length > 255) return error("nameSnapshot inválido");
      updates.nameSnapshot = n;
    }

    if (Object.keys(updates).length > 0) await row.update(updates);
    return ok(row.toJSON());
  } catch (err) {
    return serverError(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE .../recipes/[pmorId] — quitar la receta de la opción (CASCADE borra
// sus ingredientes snapshot).
// ─────────────────────────────────────────────────────────────────────────────
export const DELETE = withTenant(async (_request, ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    let row;
    try {
      row = await resolve(ctx, tenantModels);
    } catch (e) {
      if (e.code === "not_found") return notFound(e.message);
      return error(e.message);
    }
    await row.destroy();
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
