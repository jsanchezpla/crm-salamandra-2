import { withPublicTenant } from "../../../../../../../lib/tenant/publicTenantContext.js";
import { ok, error, notFound, serverError } from "../../../../../../../lib/utils/apiResponse.js";
import { cancelBookingRow } from "../../../../../../../lib/citas/cancelBooking.js";
import { cancelacionBloqueada, mensajeCancelacionBloqueada } from "../../../../../../../lib/citas/cancelacion.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/public/c/[tenantSlug]/cancel/[token]
 *
 * Body opcional: { reason }
 *
 * Cancela un Booking por su cancellationToken. Devuelve los mismos códigos
 * de estado que GET /booking/[token] cuando el booking ya no es cancelable.
 *
 * La lógica de cancelación (validar + update + audit) vive en
 * `lib/citas/cancelBooking.js`, compartida con el portal SSO `citas-portal/cancel/[id]`.
 */
export const POST = withPublicTenant(async (request, { params }, ctx) => {
  try {
    const { tenant, tenantModels, hasModule } = ctx;
    if (!hasModule("citas")) return notFound("Módulo no disponible");
    /*
     * El centro puede tener bloqueada la anulación por la familia (08/08/2026).
     *
     * Esta es la puerta IMPORTANTE de las dos: el token viaja en el correo de
     * cada cita, no caduca nunca y cancela sin sesión —quien tenga el enlace,
     * cancela—. Dejar de meterlo en los correos futuros no sirve de nada por sí
     * solo: los correos ya enviados siguen en la bandeja de entrada de las
     * familias y sus enlaces seguirían valiendo. Por eso se cierra aquí.
     *
     * 410 y no 403 a propósito: la pantalla del enlace ya sabe pintar el 410
     * como «esta cita ya no se puede cancelar» con el texto que le demos, así
     * que la familia ve un mensaje que le dice qué hacer en vez de un error.
     */
    if (cancelacionBloqueada(tenant)) return error(mensajeCancelacionBloqueada(tenant), 410);
    const ip = request.headers.get("x-forwarded-for") ?? null;

    const { token } = await params;
    if (!token || !UUID_RE.test(token)) return notFound("Token no encontrado");

    let body = {};
    try { body = (await request.json()) ?? {}; } catch { /* body opcional */ }
    const reason = body?.reason != null ? String(body.reason).trim() : null;

    const { Booking } = tenantModels;
    const row = await Booking.findOne({ where: { cancellationToken: token } });
    if (!row) return notFound("Reserva no encontrada");

    let res;
    try {
      res = await cancelBookingRow({
        booking: row,
        tenantId: tenant.id,
        reason,
        source: "landing",
        ip,
        // Con ctx se aplica la política de reembolso: quien cancela desde el
        // enlace de su email es siempre el paciente.
        ctx,
        quienCancela: "cliente",
        // Avisa al centro por la campana: antes esta cancelación era muda.
        tenant,
        tenantModels,
      });
    } catch (err) {
      if (err.code === "ALREADY_CANCELLED") return error("Esta cita ya fue cancelada", 410);
      if (err.code === "ALREADY_PAST") return error("Esta cita ya ha pasado y no se puede cancelar", 410);
      throw err;
    }

    // Se informa del dinero: el paciente tiene que saber si se le devuelve.
    return ok({ ok: true, reembolso: res?.reembolso ?? null });
  } catch (err) {
    return serverError(err);
  }
});
