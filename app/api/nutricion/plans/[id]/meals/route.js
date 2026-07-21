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

    // Día de la semana (rework 2026-07-22): 1=Lunes…7=Domingo, null = sin día.
    let weekday = null;
    if (body.weekday !== undefined && body.weekday !== null) {
      const w = Number(body.weekday);
      if (!Number.isInteger(w) || w < 1 || w > 7) return error("weekday inválido (1-7 o null)");
      weekday = w;
    }

    let order;
    if (body.order === undefined || body.order === null) {
      // El orden es relativo a su día (o al bloque "sin día"), no global.
      const where = { planId, weekday };
      const maxOrder = (await PlanMeal.max("order", { where })) ?? -1;
      order = Number(maxOrder) + 1;
    } else {
      const n = Number(body.order);
      if (!Number.isInteger(n) || n < 0) return error("order inválido");
      order = n;
    }

    const meal = await PlanMeal.create({ planId, name, description, order, weekday });
    return created(meal.toJSON());
  } catch (err) {
    return serverError(err);
  }
});
