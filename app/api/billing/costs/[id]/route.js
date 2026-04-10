import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, noContent, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";

export const GET = withTenant(async (request, { params }, { tenantModels }) => {
  try {
    const { Cost, TeamMember } = tenantModels;
    const { id } = await params;
    const cost = await Cost.findByPk(id, {
      include: [{ model: TeamMember, as: "therapist", attributes: ["id", "displayName"] }],
    });
    if (!cost) return notFound("Coste no encontrado");
    return ok(cost);
  } catch (err) {
    return serverError(err);
  }
});

export const PATCH = withTenant(async (request, { params }, { tenantModels }) => {
  try {
    const { Cost } = tenantModels;
    const { id } = await params;
    const body = await request.json();
    const cost = await Cost.findByPk(id);
    if (!cost) return notFound("Coste no encontrado");
    const allowed = ["month", "type", "category", "description", "amount", "therapistId"];
    const updates = {};
    for (const key of allowed) {
      if (key in body) updates[key] = body[key];
    }
    await cost.update(updates);
    return ok(cost);
  } catch (err) {
    return serverError(err);
  }
});

export const DELETE = withTenant(async (request, { params }, { tenantModels }) => {
  try {
    const { Cost } = tenantModels;
    const { id } = await params;
    const cost = await Cost.findByPk(id);
    if (!cost) return notFound("Coste no encontrado");
    await cost.destroy();
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
