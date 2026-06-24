import { withTenant } from "../../../../../../../lib/tenant/withTenant.js";
import {
  ok,
  error,
  forbidden,
  notFound,
  noContent,
  serverError,
} from "../../../../../../../lib/utils/apiResponse.js";
import { assertMealBelongsToPlan } from "../../../../../../../lib/nutricion/plans.js";

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/nutricion/plans/[planId]/meals/[mealId]
// ─────────────────────────────────────────────────────────────────────────────
export const PATCH = withTenant(async (request, ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { id: planId, mealId } = await ctx.params;
    const { PlanMeal } = tenantModels;

    let meal;
    try {
      meal = await assertMealBelongsToPlan(PlanMeal, planId, mealId);
    } catch (e) {
      if (e.code === "not_found") return notFound(e.message);
      return error(e.message);
    }

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }
    const updates = {};
    if (body.name !== undefined) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) return error("name requerido");
      updates.name = name;
    }
    if (body.description !== undefined) {
      updates.description = body.description === null ? null : String(body.description).slice(0, 5000);
    }
    if (body.order !== undefined) {
      const n = Number(body.order);
      if (!Number.isInteger(n) || n < 0) return error("order inválido");
      updates.order = n;
    }
    if (Object.keys(updates).length > 0) await meal.update(updates);
    return ok(meal.toJSON());
  } catch (err) {
    return serverError(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/nutricion/plans/[planId]/meals/[mealId] — hard delete (CASCADE)
// ─────────────────────────────────────────────────────────────────────────────
export const DELETE = withTenant(async (_request, ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { id: planId, mealId } = await ctx.params;
    const { PlanMeal } = tenantModels;

    let meal;
    try {
      meal = await assertMealBelongsToPlan(PlanMeal, planId, mealId);
    } catch (e) {
      if (e.code === "not_found") return notFound(e.message);
      return error(e.message);
    }
    await meal.destroy();
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
