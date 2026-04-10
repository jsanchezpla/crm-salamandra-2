import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, error, serverError } from "../../../../lib/utils/apiResponse.js";

// GET /api/billing/costs?month=2026-04&type=salary&category=fixed
export const GET = withTenant(async (request, _ctx, { tenantModels }) => {
  try {
    const { Cost, TeamMember } = tenantModels;
    const { searchParams } = new URL(request.url);

    const where = {};
    if (searchParams.get("month")) where.month = searchParams.get("month");
    if (searchParams.get("type")) where.type = searchParams.get("type");
    if (searchParams.get("category")) where.category = searchParams.get("category");
    if (searchParams.get("therapistId")) where.therapistId = searchParams.get("therapistId");

    const costs = await Cost.findAll({
      where,
      include: [{ model: TeamMember, as: "therapist", attributes: ["id", "displayName"] }],
      order: [["month", "DESC"], ["type", "ASC"]],
    });

    return ok(costs);
  } catch (err) {
    return serverError(err);
  }
});

// POST /api/billing/costs
export const POST = withTenant(async (request, _ctx, { tenantModels }) => {
  try {
    const { Cost } = tenantModels;
    const body = await request.json();

    const { month, type, category, description, amount, therapistId } = body;

    if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return error("month inválido (formato YYYY-MM)");
    if (!type) return error("type es obligatorio");
    if (!category) return error("category es obligatorio");
    if (!description) return error("description es obligatorio");
    if (!amount || Number(amount) <= 0) return error("amount debe ser mayor que 0");

    const cost = await Cost.create({
      month,
      type,
      category,
      description,
      amount: Number(amount),
      therapistId: therapistId || null,
    });

    return created(cost);
  } catch (err) {
    return serverError(err);
  }
});
