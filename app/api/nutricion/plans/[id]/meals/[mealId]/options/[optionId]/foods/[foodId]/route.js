import { withTenant } from "../../../../../../../../../../../lib/tenant/withTenant.js";
import {
  ok,
  error,
  forbidden,
  notFound,
  noContent,
  serverError,
} from "../../../../../../../../../../../lib/utils/apiResponse.js";
import {
  assertMealBelongsToPlan,
  assertOptionBelongsToMeal,
  assertFoodLineBelongsToOption,
  sanitizeFoodLine,
} from "../../../../../../../../../../../lib/nutricion/plans.js";

// IMPORTANTE: el segmento dinámico aquí es [foodId] pero NO es el id del
// alimento del catálogo (Food.id); es el id de la fila plan_meal_option_foods
// (la línea de alimento dentro de la opción). Llamarlo así por convención de
// path "/foods/<id>"; en el body NO se permite cambiar el food_id (cambia
// food → borra y crea).

// ─────────────────────────────────────────────────────────────────────────────
// PATCH .../foods/[foodId]
// ─────────────────────────────────────────────────────────────────────────────
export const PATCH = withTenant(async (request, ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { id: planId, mealId, optionId, foodId } = await ctx.params;
    const { PlanMeal, PlanMealOption, PlanMealOptionFood, Food } = tenantModels;

    try {
      await assertMealBelongsToPlan(PlanMeal, planId, mealId);
      await assertOptionBelongsToMeal(PlanMealOption, mealId, optionId);
    } catch (e) {
      if (e.code === "not_found") return notFound(e.message);
      return error(e.message);
    }
    let line;
    try {
      line = await assertFoodLineBelongsToOption(PlanMealOptionFood, optionId, foodId);
    } catch (e) {
      if (e.code === "not_found") return notFound(e.message);
      return error(e.message);
    }

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    // Bloquear cambio de food_id: para cambiar de alimento, borrar + crear
    if (body.foodId !== undefined || body.food_id !== undefined) {
      const fid = body.foodId ?? body.food_id;
      if (fid !== line.foodId) {
        return error("Para cambiar de alimento, borrar la línea y crear una nueva", 422);
      }
    }
    delete body.foodId; delete body.food_id;

    const v = sanitizeFoodLine(body, { isCreate: false });
    if (!v.ok) return error(v.error);
    const updates = v.value;

    // Si se va a cambiar unit, validar coherencia con los demás campos
    // (los que no llegan los tomamos del registro actual)
    if (updates.unit) {
      const merged = {
        unit: updates.unit,
        amount: updates.amount !== undefined ? updates.amount : line.amount,
        householdLabel: updates.householdLabel !== undefined ? updates.householdLabel : line.householdLabel,
        householdGrams: updates.householdGrams !== undefined ? updates.householdGrams : line.householdGrams,
      };
      if (merged.unit === "g") {
        if (merged.amount == null) return error("unit='g' requiere amount");
        if (merged.householdLabel != null || merged.householdGrams != null) {
          return error("unit='g' no admite household_*");
        }
      } else if (merged.unit === "household") {
        if (merged.amount == null) return error("unit='household' requiere amount");
        if (!merged.householdLabel) return error("unit='household' requiere household_label");
        if (merged.householdGrams == null) return error("unit='household' requiere household_grams");
      } else if (merged.unit === "free") {
        if (merged.amount != null) return error("unit='free' no admite amount");
        if (merged.householdLabel != null || merged.householdGrams != null) {
          return error("unit='free' no admite household_*");
        }
      }
    }

    if (Object.keys(updates).length === 0) return ok(line.toJSON());

    try {
      await line.update(updates);
      return ok(line.toJSON());
    } catch (e) {
      if (String(e.message).includes("plan_meal_option_foods_unit_chk")) {
        return error("Combinación unit/amount/household inválida", 400);
      }
      throw e;
    }
  } catch (err) {
    return serverError(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE .../foods/[foodId]
// ─────────────────────────────────────────────────────────────────────────────
export const DELETE = withTenant(async (_request, ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { id: planId, mealId, optionId, foodId } = await ctx.params;
    const { PlanMeal, PlanMealOption, PlanMealOptionFood } = tenantModels;

    try {
      await assertMealBelongsToPlan(PlanMeal, planId, mealId);
      await assertOptionBelongsToMeal(PlanMealOption, mealId, optionId);
    } catch (e) {
      if (e.code === "not_found") return notFound(e.message);
      return error(e.message);
    }
    let line;
    try {
      line = await assertFoodLineBelongsToOption(PlanMealOptionFood, optionId, foodId);
    } catch (e) {
      if (e.code === "not_found") return notFound(e.message);
      return error(e.message);
    }
    await line.destroy();
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
