import { withTenant } from "../../../../../../../../lib/tenant/withTenant.js";
import {
  created,
  error,
  forbidden,
  notFound,
  serverError,
} from "../../../../../../../../lib/utils/apiResponse.js";
import { assertMealBelongsToPlan } from "../../../../../../../../lib/nutricion/plans.js";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/nutricion/plans/[planId]/meals/[mealId]/options — añadir opción
// ─────────────────────────────────────────────────────────────────────────────
export const POST = withTenant(async (request, ctx, { tenantModels, tenantSequelize, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { id: planId, mealId } = await ctx.params;
    const { PlanMeal, PlanMealOption } = tenantModels;

    try {
      await assertMealBelongsToPlan(PlanMeal, planId, mealId);
    } catch (e) {
      if (e.code === "not_found") return notFound(e.message);
      return error(e.message);
    }

    let body = {};
    try { body = (await request.json()) || {}; } catch { /* opcional */ }

    let order;
    if (body.order === undefined || body.order === null) {
      const maxOrder = (await PlanMealOption.max("order", { where: { mealId } })) ?? -1;
      order = Number(maxOrder) + 1;
    } else {
      const n = Number(body.order);
      if (!Number.isInteger(n) || n < 0) return error("order inválido");
      order = n;
    }

    let name;
    if (typeof body.name === "string" && body.name.trim()) {
      name = body.name.trim();
    } else {
      // Default 'Opción N+1'
      const total = await PlanMealOption.count({ where: { mealId } });
      name = `Opción ${total + 1}`;
    }

    const isDefault = body.isDefault === undefined ? false : Boolean(body.isDefault);

    const option = await tenantSequelize.transaction(async (t) => {
      if (isDefault) {
        await PlanMealOption.update(
          { isDefault: false },
          { where: { mealId }, transaction: t }
        );
      }
      return await PlanMealOption.create(
        { mealId, name, order, isDefault },
        { transaction: t }
      );
    });

    return created(option.toJSON());
  } catch (err) {
    return serverError(err);
  }
});
