import { withTenant } from "../../../../../../../../../../lib/tenant/withTenant.js";
import {
  created,
  error,
  forbidden,
  notFound,
  serverError,
} from "../../../../../../../../../../lib/utils/apiResponse.js";
import {
  assertMealBelongsToPlan,
  assertOptionBelongsToMeal,
  sanitizeFoodLine,
} from "../../../../../../../../../../lib/nutricion/plans.js";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/nutricion/plans/[planId]/meals/[mealId]/options/[optionId]/foods
// Body: { food_id, unit, amount?, household_label?, household_grams?, notes?, order? }
// El CHECK plan_meal_option_foods_unit_chk de BD también atrapa errores;
// aquí validamos antes para devolver 400 con mensaje claro.
// ─────────────────────────────────────────────────────────────────────────────
export const POST = withTenant(async (request, ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { id: planId, mealId, optionId } = await ctx.params;
    const { PlanMeal, PlanMealOption, PlanMealOptionFood, Food } = tenantModels;

    try {
      await assertMealBelongsToPlan(PlanMeal, planId, mealId);
      await assertOptionBelongsToMeal(PlanMealOption, mealId, optionId);
    } catch (e) {
      if (e.code === "not_found") return notFound(e.message);
      return error(e.message);
    }

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const v = sanitizeFoodLine(body, { isCreate: true });
    if (!v.ok) return error(v.error);
    const value = v.value;

    // Verificar food existe y NO está archivado
    const food = await Food.findByPk(value.foodId);
    if (!food || food.archivedAt) return error("Alimento no encontrado o archivado", 422);

    // Order: default = max+1 dentro de la opción
    if (value.order === undefined) {
      const maxOrder = (await PlanMealOptionFood.max("order", { where: { optionId } })) ?? -1;
      value.order = Number(maxOrder) + 1;
    }

    try {
      const line = await PlanMealOptionFood.create({
        optionId,
        foodId: value.foodId,
        amount: value.amount ?? null,
        unit: value.unit,
        householdLabel: value.householdLabel ?? null,
        householdGrams: value.householdGrams ?? null,
        notes: value.notes ?? null,
        order: value.order,
      });
      return created(line.toJSON());
    } catch (e) {
      // Si el CHECK de BD revienta lo devolvemos como 400
      if (String(e.message).includes("plan_meal_option_foods_unit_chk")) {
        return error("Combinación unit/amount/household inválida", 400);
      }
      throw e;
    }
  } catch (err) {
    return serverError(err);
  }
});
