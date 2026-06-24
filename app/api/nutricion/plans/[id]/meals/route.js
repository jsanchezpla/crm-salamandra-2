import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import {
  created,
  error,
  forbidden,
  notFound,
  serverError,
} from "../../../../../../lib/utils/apiResponse.js";
import { UUID_RE } from "../../../../../../lib/nutricion/plans.js";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/nutricion/plans/[planId]/meals — añadir comida
// ─────────────────────────────────────────────────────────────────────────────
export const POST = withTenant(async (request, ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { id: planId } = await ctx.params;
    if (!UUID_RE.test(planId)) return error("planId inválido");

    const { Plan, PlanMeal } = tenantModels;
    const plan = await Plan.findByPk(planId);
    if (!plan || plan.archivedAt) return notFound("Plan no encontrado");

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 1) return error("name requerido");
    const description = body.description === undefined || body.description === null
      ? null
      : String(body.description).slice(0, 5000);

    let order;
    if (body.order === undefined || body.order === null) {
      const maxOrder = (await PlanMeal.max("order", { where: { planId } })) ?? -1;
      order = Number(maxOrder) + 1;
    } else {
      const n = Number(body.order);
      if (!Number.isInteger(n) || n < 0) return error("order inválido");
      order = n;
    }

    const meal = await PlanMeal.create({ planId, name, description, order });
    return created(meal.toJSON());
  } catch (err) {
    return serverError(err);
  }
});
