import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, noContent, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";

// GET /api/billing/rates/[id]
export const GET = withTenant(async (request, { params }, { tenantModels }) => {
  try {
    const { Rate, TeamMember } = tenantModels;
    const { id } = await params;

    const rate = await Rate.findByPk(id, {
      include: [{ model: TeamMember, as: "therapist", attributes: ["id", "displayName"] }],
    });

    if (!rate) return notFound("Tarifa no encontrada");
    return ok(rate);
  } catch (err) {
    return serverError(err);
  }
});

// PATCH /api/billing/rates/[id]
export const PATCH = withTenant(async (request, { params }, { tenantModels }) => {
  try {
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
export const DELETE = withTenant(async (request, { params }, { tenantModels }) => {
  try {
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
