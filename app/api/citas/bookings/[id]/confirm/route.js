import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { logCitasAudit } from "../../../../../../lib/citas/audit.js";
import { findBookingOverlap } from "../../../../../../lib/citas/booking.js";
import { sendEmail } from "../../../../../../lib/email/resendClient.js";
import { bookingConfirmedTemplate } from "../../../../../../lib/email/templates/citas/bookingConfirmed.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * PATCH /api/citas/bookings/[id]/confirm
 *
 * Transición pending → confirmed. Idempotente:
 *   - Si ya está confirmed, devuelve 200 con el booking sin cambios.
 *   - Si está cancelled/completed/no_show, devuelve 409 (no permitido).
 *   - Si está pending, valida solapamiento y confirma.
 *
 * Dispara email "booking-confirmed" en Checkpoint 2 (Resend). En este
 * checkpoint solo cambia el estado.
 */
export const PATCH = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");
    const userRole = request.headers.get("x-user-role") ?? "user";
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;
    if (!ADMIN_ROLES.has(userRole)) return forbidden("Solo admin puede confirmar citas");

    const { id } = await params;
    const { Booking, EventType } = tenantModels;
    const row = await Booking.findByPk(id, {
      include: [{ model: EventType, as: "eventType" }],
    });
    if (!row) return notFound("Cita no encontrada");

    if (row.status === "confirmed") {
      // Idempotencia: ya confirmada.
      process.stdout.write(`[citas:confirm] booking=${row.id} noop (ya confirmed)\n`);
      return ok(row.toJSON());
    }

    if (row.status !== "pending") {
      return forbidden(`No se puede confirmar una cita en estado '${row.status}'`);
    }

    // Validar solapamiento con otras citas activas del MISMO profesional.
    const overlap = await findBookingOverlap(Booking, {
      scheduledAt: row.scheduledAt,
      duration: row.duration,
      excludeId: row.id,
      teamMemberId: row.teamMemberId,
    });
    if (overlap) {
      return forbidden(
        `La cita solapa con otra activa el ${overlap.scheduledAt.toISOString?.() ?? overlap.scheduledAt}`
      );
    }

    const before = row.toJSON();
    await row.update({ status: "confirmed" });
    await row.reload();

    await logCitasAudit({
      tenantId: tenant.id,
      userId,
      action: "citas.booking_confirmed",
      entity: "Booking",
      entityId: row.id,
      before: { status: before.status },
      after: { status: "confirmed" },
      ip,
    });

    process.stdout.write(`[citas:confirm] booking=${row.id} pending→confirmed\n`);

    // Email best-effort: si falla, log + sigue. No rompe el flujo.
    try {
      const cancelUrl = row.cancellationToken
        ? `/widget/c/${tenant.slug}/cancel/${row.cancellationToken}`
        : null;
      const { subject, html, text } = bookingConfirmedTemplate({
        tenantName: tenant.name,
        brand: tenant.settings?.brand,
        clientName: row.clientName,
        eventTypeName: row.eventType?.name ?? "tu cita",
        scheduledAt: row.scheduledAt,
        duration: row.duration,
        modality: row.modality,
        meetUrl: row.meetUrl,
        cancelUrl,
        location: row.eventType?.location ?? null,
      });
      await sendEmail({ to: row.clientEmail, subject, html, text });
    } catch (mailErr) {
      process.stderr.write(`[citas:confirm] email-confirmed fail: ${mailErr.message}\n`);
    }

    return ok(row.toJSON());
  } catch (err) {
    return serverError(err);
  }
});
