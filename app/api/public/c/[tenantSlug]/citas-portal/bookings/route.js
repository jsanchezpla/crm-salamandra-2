import { Op } from "sequelize";
import { withPublicTenant } from "../../../../../../../lib/tenant/publicTenantContext.js";
import { ok, unauthorized, forbidden, notFound, serverError } from "../../../../../../../lib/utils/apiResponse.js";
import { verifyPortalSession, readBearer } from "../../../../../../../lib/citas/portalSession.js";
import { splitBookings } from "../../../../../../../lib/citas/clientBookingSerializer.js";

/**
 * GET /api/public/c/[tenantSlug]/citas-portal/bookings
 *
 * Lista las citas del cliente autenticado con el sessionToken (por email).
 * Requiere `Authorization: Bearer <sessionToken>`.
 *
 *   200: { ok, data: { upcoming: [...], history: [...] } }
 *   401: sesión ausente/inválida/caducada · 403: SSO no habilitado · 404: tenant/módulo
 */
export const GET = withPublicTenant(async (request, _ctx, { slug, tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return notFound("Módulo no disponible");
    if (tenant.settings?.widget?.sso?.enabled !== true) return forbidden("Portal de citas no habilitado");

    let email;
    try {
      ({ email } = await verifyPortalSession(readBearer(request), slug));
    } catch {
      return unauthorized("Sesión no válida o caducada");
    }

    const { Booking, EventType } = tenantModels;
    const rows = await Booking.findAll({
      where: { clientEmail: { [Op.iLike]: email } }, // usa bookings_client_email_idx
      include: [{ model: EventType, as: "eventType", attributes: ["id", "name", "color"] }],
      order: [["scheduledAt", "ASC"]],
    });

    return ok(splitBookings(rows, new Date()));
  } catch (err) {
    return serverError(err);
  }
});
