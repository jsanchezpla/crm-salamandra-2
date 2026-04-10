import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, error, serverError } from "../../../../lib/utils/apiResponse.js";

// GET /api/billing/rates
export const GET = withTenant(async (request, _ctx, { tenantModels }) => {
  try {
    const { Rate, TeamMember } = tenantModels;
    const { searchParams } = new URL(request.url);

    const where = {};
    if (searchParams.get("serviceType")) where.serviceType = searchParams.get("serviceType");
    if (searchParams.get("therapistId")) where.therapistId = searchParams.get("therapistId");
    if (searchParams.get("activeOnly") === "true") where.validTo = null;

    const rates = await Rate.findAll({
      where,
      include: [{ model: TeamMember, as: "therapist", attributes: ["id", "displayName"] }],
      order: [["validFrom", "DESC"]],
    });

    return ok(rates);
  } catch (err) {
    return serverError(err);
  }
});

// POST /api/billing/rates
export const POST = withTenant(async (request, _ctx, { tenantModels }) => {
  try {
    const { Rate } = tenantModels;
    const body = await request.json();

    const { therapistId, serviceType, pricePerSession, packConfig, validFrom, validTo } = body;

    if (!serviceType) return error("serviceType es obligatorio");
    if (!pricePerSession || Number(pricePerSession) <= 0) return error("pricePerSession debe ser mayor que 0");
    if (!validFrom) return error("validFrom es obligatorio");

    const rate = await Rate.create({
      therapistId: therapistId || null,
      serviceType,
      pricePerSession: Number(pricePerSession),
      packConfig: packConfig || {},
      validFrom,
      validTo: validTo || null,
    });

    return created(rate);
  } catch (err) {
    return serverError(err);
  }
});
