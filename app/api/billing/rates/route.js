import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

// GET /api/billing/rates
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Rate, TeamMember } = tenantModels;
    const { searchParams } = new URL(request.url);

    const where = {};
    if (searchParams.get("serviceType")) where.serviceType = searchParams.get("serviceType");
    if (searchParams.get("employeeId")) where.employeeId = searchParams.get("employeeId");
    if (searchParams.get("activeOnly") === "true") where.validTo = null;

    const rates = await Rate.findAll({
      where,
      include: [{ model: TeamMember, as: "employee", attributes: ["id", "displayName"] }],
      order: [["validFrom", "DESC"]],
    });

    return ok(rates);
  } catch (err) {
    return serverError(err);
  }
});

// POST /api/billing/rates
export const POST = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const role = request.headers.get("x-user-role");
    if (!ADMIN_ROLES.has(role)) return forbidden("Solo administradores pueden gestionar tarifas");

    const { Rate } = tenantModels;
    const body = await request.json();

    const { employeeId, serviceType, pricePerSession, packConfig, validFrom, validTo } = body;

    if (!serviceType) return error("serviceType es obligatorio");
    if (!pricePerSession || Number(pricePerSession) <= 0) return error("pricePerSession debe ser mayor que 0");
    if (!validFrom) return error("validFrom es obligatorio");

    const rate = await Rate.create({
      employeeId: employeeId || null,
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
