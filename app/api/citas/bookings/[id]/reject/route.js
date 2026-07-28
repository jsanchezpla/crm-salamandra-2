import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { logCitasAudit } from "../../../../../../lib/citas/audit.js";
import { normalizeString } from "../../../../../../lib/citas/validation.js";
import { sendEmail } from "../../../../../../lib/email/resendClient.js";
import { bookingRejectedTemplate } from "../../../../../../lib/email/templates/citas/bookingRejected.js";
import { reembolsarCitaSiProcede } from "../../../../../../lib/citas/reembolsoCita.js";
import { getTenantResendConfig } from "../../../../../../lib/outreach/resendConfig.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * PATCH /api/citas/bookings/[id]/reject
 *
 * Transición pending → cancelled (con cancellationReason opcional).
 *
 * Solo admite reject sobre bookings 'pending'. Para cancelar un booking
 * confirmado, usar PATCH /api/citas/bookings/[id] con { status: 'cancelled' }
 * o DELETE.
 *
 * Idempotente: si el booking ya está cancelled, devuelve 200 sin cambios.
 *
 * Dispara email "booking-rejected" en Checkpoint 2 (Resend). En este
 * checkpoint solo cambia el estado.
 */
export const PATCH = withTenant(async (request, { params }, ctx) => {
  try {
    const { tenant, tenantModels, hasModule } = ctx;
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");
    const userRole = request.headers.get("x-user-role") ?? "user";
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;
    if (!ADMIN_ROLES.has(userRole)) return forbidden("Solo admin puede rechazar citas");

    const { id } = await params;
    const { Booking, EventType } = tenantModels;
    const row = await Booking.findByPk(id, {
      include: [{ model: EventType, as: "eventType" }],
    });
    if (!row) return notFound("Cita no encontrada");

    let body = {};
    try { body = await request.json(); } catch { /* body opcional */ }

    const reason = body.cancellationReason != null
      ? normalizeString(body.cancellationReason)
      : null;

    if (row.status === "cancelled") {
      process.stdout.write(`[citas:reject] booking=${row.id} noop (ya cancelled)\n`);
      return ok(row.toJSON());
    }

    if (row.status !== "pending") {
      return error(
        `No se puede rechazar una cita en estado '${row.status}' — solo 'pending'`,
        409
      );
    }

    const before = row.toJSON();
    await row.update({
      status: "cancelled",
      cancelledAt: new Date(),
      cancellationReason: reason ?? null,
    });
    await row.reload();

    // Si la rechaza el profesional, el dinero vuelve íntegro pase lo que pase
    // (política acordada). Best-effort: el rechazo no falla si Stripe no responde.
    const reembolso = await reembolsarCitaSiProcede(ctx, row, { quienCancela: "profesional" });
    if (reembolso.reembolsado) await row.reload();

    await logCitasAudit({
      tenantId: tenant.id,
      userId,
      action: "citas.booking_rejected",
      entity: "Booking",
      entityId: row.id,
      before: { status: before.status },
      after: { status: "cancelled", cancellationReason: reason ?? null, reembolso },
      ip,
    });

    process.stdout.write(`[citas:reject] booking=${row.id} pending→cancelled reason="${reason ?? "—"}"\n`);

    // Email best-effort.
    try {
      const { subject, html, text } = bookingRejectedTemplate({
        tenantName: tenant.name,
        brand: tenant.settings?.brand,
        clientName: row.clientName,
        eventTypeName: row.eventType?.name ?? "la cita solicitada",
        scheduledAt: row.scheduledAt,
        reason,
      });
      // BYOK: cada cliente manda desde SU cuenta de Resend y su dominio
      // (mejor entrega, y su consumo no gasta el cupo de los demás).
      const cfgResend = getTenantResendConfig({ tenant });
      await sendEmail({
        to: row.clientEmail,
        subject,
        html,
        text,
        from: cfgResend.fromEmail || undefined,
        replyTo: cfgResend.replyTo || undefined,
        apiKey: cfgResend.apiKey || undefined,
      });
    } catch (mailErr) {
      process.stderr.write(`[citas:reject] email-rejected fail: ${mailErr.message}\n`);
    }

    return ok(row.toJSON());
  } catch (err) {
    return serverError(err);
  }
});
