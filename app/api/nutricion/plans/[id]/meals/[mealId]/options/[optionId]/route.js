import { withTenant } from "../../../../../../../../../lib/tenant/withTenant.js";
import {
  ok,
  error,
  forbidden,
  notFound,
  noContent,
  serverError,
} from "../../../../../../../../../lib/utils/apiResponse.js";
import {
  assertMealBelongsToPlan,
  assertOptionBelongsToMeal,
} from "../../../../../../../../../lib/nutricion/plans.js";

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/nutricion/plans/[planId]/meals/[mealId]/options/[optionId]
// ─────────────────────────────────────────────────────────────────────────────
export const PATCH = withTenant(async (request, ctx, { tenantModels, tenantSequelize, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { id: planId, mealId, optionId } = await ctx.params;
    const { PlanMeal, PlanMealOption } = tenantModels;

    try {
      await assertMealBelongsToPlan(PlanMeal, planId, mealId);
    } catch (e) {
      if (e.code === "not_found") return notFound(e.message);
      return error(e.message);
    }
    let option;
    try {
      option = await assertOptionBelongsToMeal(PlanMealOption, mealId, optionId);
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
    if (body.order !== undefined) {
      const n = Number(body.order);
      if (!Number.isInteger(n) || n < 0) return error("order inválido");
      updates.order = n;
    }

    const setDefault = body.isDefault === undefined ? null : Boolean(body.isDefault);

    await tenantSequelize.transaction(async (t) => {
      if (setDefault === true) {
        // Forzar única opción default por comida
        await PlanMealOption.update(
          { isDefault: false },
          { where: { mealId }, transaction: t }
        );
        updates.isDefault = true;
      } else if (setDefault === false) {
        updates.isDefault = false;
      }
      if (Object.keys(updates).length > 0) {
        await option.update(updates, { transaction: t });
      }
    });

    return ok(option.toJSON());
  } catch (err) {
    return serverError(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/nutricion/plans/[planId]/meals/[mealId]/options/[optionId]
// ─────────────────────────────────────────────────────────────────────────────
export const DELETE = withTenant(async (_request, ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { id: planId, mealId, optionId } = await ctx.params;
    const { PlanMeal, PlanMealOption } = tenantModels;

    try {
      await assertMealBelongsToPlan(PlanMeal, planId, mealId);
    } catch (e) {
      if (e.code === "not_found") return notFound(e.message);
      return error(e.message);
    }
    let option;
    try {
      option = await assertOptionBelongsToMeal(PlanMealOption, mealId, optionId);
    } catch (e) {
      if (e.code === "not_found") return notFound(e.message);
      return error(e.message);
    }
    await option.destroy();
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
