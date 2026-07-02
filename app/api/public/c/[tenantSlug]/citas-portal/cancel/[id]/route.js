import { withPublicTenant } from "../../../../../../../../lib/tenant/publicTenantContext.js";
import { ok, error, unauthorized, forbidden, notFound, serverError } from "../../../../../../../../lib/utils/apiResponse.js";
import { verifyPortalSession, readBearer } from "../../../../../../../../lib/citas/portalSession.js";
import { cancelBookingRow } from "../../../../../../../../lib/citas/cancelBooking.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/public/c/[tenantSlug]/citas-portal/cancel/[id]
 *
 * Cancela una cita del cliente autenticado, por `id`, verificando ANTES la
 * propiedad (el `clientEmail` de la cita debe coincidir con el email del
 * sessionToken). Requiere `Authorization: Bearer <sessionToken>`.
 *
 * Body opcional: { reason }
 *   200: { ok, data: { ok: true } }
 *   401: sesión inválida · 403: SSO no habilitado · 404: id inválido / no existe / ajeno
 *   410: ya cancelada / ya pasó
 *
 * Ownership: si el id no existe O pertenece a otro email → 404 (no 403), para no
 * revelar la existencia de citas ajenas.
 */
export const POST = withPublicTenant(async (request, { params }, { slug, tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return notFound("Módulo no disponible");
    if (tenant.settings?.widget?.sso?.enabled !== true) return forbidden("Portal de citas no habilitado");

    let email;
    try {
      ({ email } = await verifyPortalSession(readBearer(request), slug));
    } catch {
      return unauthorized("Sesión no válida o caducada");
    }

    const { id } = await params;
    if (!id || !UUID_RE.test(id)) return notFound("Reserva no encontrada");

    const ip = request.headers.get("x-forwarded-for") ?? null;
    let body = {};
    try { body = (await request.json()) ?? {}; } catch { /* body opcional */ }
    const reason = body?.reason != null ? String(body.reason).trim() : null;

    const { Booking } = tenantModels;
    const row = await Booking.findByPk(id);
    const owner =
      row && String(row.clientEmail).trim().toLowerCase() === String(email).trim().toLowerCase();
    if (!owner) return notFound("Reserva no encontrada");

    try {
      await cancelBookingRow({ booking: row, tenantId: tenant.id, reason, source: "citas-portal", ip });
    } catch (err) {
      if (err.code === "ALREADY_CANCELLED") return error("Esta cita ya fue cancelada", 410);
      if (err.code === "ALREADY_PAST") return error("Esta cita ya ha pasado y no se puede cancelar", 410);
      throw err;
    }

    return ok({ ok: true });
  } catch (err) {
    return serverError(err);
  }
});
