import { withPublicTenant } from "../../../../../../../lib/tenant/publicTenantContext.js";
import { ok, error, notFound, serverError } from "../../../../../../../lib/utils/apiResponse.js";
import { logCitasAudit } from "../../../../../../../lib/citas/audit.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/public/c/[tenantSlug]/cancel/[token]
 *
 * Body opcional: { reason }
 *
 * Cancela un Booking por su cancellationToken. Devuelve los mismos códigos
 * de estado que GET /booking/[token] cuando el booking ya no es cancelable.
 */
export const POST = withPublicTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return notFound("Módulo no disponible");
    const ip = request.headers.get("x-forwarded-for") ?? null;

    const { token } = await params;
    if (!token || !UUID_RE.test(token)) return notFound("Token no encontrado");

    let body = {};
    try { body = (await request.json()) ?? {}; } catch { /* body opcional */ }

    const reasonRaw = body?.reason;
    const reason = reasonRaw != null ? String(reasonRaw).trim() : null;

    const { Booking } = tenantModels;
    const row = await Booking.findOne({ where: { cancellationToken: token } });
    if (!row) return notFound("Reserva no encontrada");

    if (row.status === "cancelled") {
      return error("Esta cita ya fue cancelada", 410);
    }
    if (new Date(row.scheduledAt) <= new Date()) {
      return error("Esta cita ya ha pasado y no se puede cancelar", 410);
    }

    const before = row.toJSON();
    await row.update({
      status: "cancelled",
      cancelledAt: new Date(),
      cancellationReason: reason || null,
    });

    await logCitasAudit({
      tenantId: tenant.id,
      userId: null,
      action: "citas.booking_cancelled",
      entity: "Booking",
      entityId: row.id,
      before,
      after: { status: "cancelled", cancellationReason: reason || null, source: "landing" },
      ip,
    });

    return ok({ ok: true });
  } catch (err) {
    return serverError(err);
  }
});
