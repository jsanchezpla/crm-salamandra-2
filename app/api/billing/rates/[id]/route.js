import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, noContent, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const ADMIN_DENY = "Solo administradores pueden gestionar tarifas";

// GET /api/billing/rates/[id]
export const GET = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Rate, TeamMember } = tenantModels;
    const { id } = await params;

    const rate = await Rate.findByPk(id, {
      include: [{ model: TeamMember, as: "employee", attributes: ["id", "displayName"] }],
    });

    if (!rate) return notFound("Tarifa no encontrada");
    return ok(rate);
  } catch (err) {
    return serverError(err);
  }
});

// PATCH /api/billing/rates/[id]
export const PATCH = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const role = request.headers.get("x-user-role");
    if (!ADMIN_ROLES.has(role)) return forbidden(ADMIN_DENY);

    const { Rate } = tenantModels;
    const { id } = await params;
    const body = await request.json();

    const rate = await Rate.findByPk(id);
    if (!rate) return notFound("Tarifa no encontrada");

    const allowed = ["pricePerSession", "packConfig", "validTo"];
    const updates = {};
    for (const key of allowed) {
      if (key in body) updates[key] = body[key];
    }

    await rate.update(updates);
    return ok(rate);
  } catch (err) {
    return serverError(err);
  }
});

// DELETE /api/billing/rates/[id]
export const DELETE = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const role = request.headers.get("x-user-role");
    if (!ADMIN_ROLES.has(role)) return forbidden(ADMIN_DENY);

    const { Rate } = tenantModels;
    const { id } = await params;

    const rate = await Rate.findByPk(id);
    if (!rate) return notFound("Tarifa no encontrada");

    await rate.destroy();
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
