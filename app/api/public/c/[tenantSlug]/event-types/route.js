import { withPublicTenant } from "../../../../../../lib/tenant/publicTenantContext.js";
import { ok, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";

/**
 * GET /api/public/c/[tenantSlug]/event-types
 *
 * Devuelve los EventType del tenant con active=true y 'online' en modalities.
 * Filtra los campos sensibles (meetUrl, location, phoneNumber, buffers).
 */
export const GET = withPublicTenant(async (_request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return notFound("Módulo no disponible");

    const { EventType } = tenantModels;
    const rows = await EventType.findAll({
      where: { active: true },
      order: [["order", "ASC"], ["createdAt", "ASC"]],
    });

    const data = rows
      .filter((r) => Array.isArray(r.modalities) && r.modalities.includes("online"))
      .map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description,
        duration: r.duration,
        color: r.color,
        additionalDataLabel: r.additionalDataLabel,
        additionalDataRequired: r.additionalDataRequired,
        minNoticeHours: r.minNoticeHours,
        maxAdvanceDays: r.maxAdvanceDays,
        order: r.order,
      }));

    return ok(data);
  } catch (err) {
    return serverError(err);
  }
});
