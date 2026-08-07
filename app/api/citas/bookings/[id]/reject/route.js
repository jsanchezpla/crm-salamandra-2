import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { citaSegunRol } from "../../../../../../lib/citas/dinero.js";
import { logCitasAudit } from "../../../../../../lib/citas/audit.js";
import { normalizeString } from "../../../../../../lib/citas/validation.js";
import { sendEmail, envioRealizado } from "../../../../../../lib/email/resendClient.js";
import { bookingRejectedTemplate } from "../../../../../../lib/email/templates/citas/bookingRejected.js";
import { reembolsarCitaSiProcede } from "../../../../../../lib/citas/reembolsoCita.js";
import { getTenantResendConfig } from "../../../../../../lib/outreach/resendConfig.js";


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
    /*
     * Rechazar una solicitud lo puede hacer cualquiera del equipo (06/08/2026,
     * Rodrigo), por lo mismo que apuntarla: quien atiende la lista de espera es
     * quien sabe que ese hueco no vale.
     *
     * No mueve dinero: rechazar solo pasa la solicitud a cancelada, no cobra
     * nada. Lo que sí cobra —confirmar, pedir la tarjeta— se queda en admin.
     */

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
      return ok(citaSegunRol(row.toJSON(), request.headers.get("x-user-role")));
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

    // El dinero, sea cual sea su forma: si estaba solo retenido se suelta, y si
    // ya se había cobrado se devuelve íntegro (lo rechaza la profesional, así
    // que la antelación no cuenta). Los dos casos los resuelve el mismo helper
    // para que ninguna vía de cancelación pueda olvidarse de uno.
    //
    // Best-effort: que Stripe no responda no puede impedir que ella rechace.
    const dinero = await reembolsarCitaSiProcede(ctx, row, { quienCancela: "profesional" });
    await row.reload();

    await logCitasAudit({
      tenantId: tenant.id,
      userId,
      action: "citas.booking_rejected",
      entity: "Booking",
      entityId: row.id,
      before: { status: before.status, paymentStatus: before.paymentStatus, importe: before.amount ?? null },
      after: { status: "cancelled", cancellationReason: reason ?? null, dinero },
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
        // Para que el correo diga que su programa sigue en pie.
        esBono: !!row.packId,
      });
      // BYOK: cada cliente manda desde SU cuenta de Resend y su dominio
      // (mejor entrega, y su consumo no gasta el cupo de los demás).
      const cfgResend = getTenantResendConfig({ tenant });
      const envio = await sendEmail({
        to: row.clientEmail,
        subject,
        html,
        text,
        from: cfgResend.fromEmail || undefined,
        replyTo: cfgResend.replyTo || undefined,
        apiKey: cfgResend.apiKey || undefined,
      });
      envioRealizado(envio, `citas:reject ${row.id}`);
    } catch (mailErr) {
      process.stderr.write(`[citas:reject] email-rejected fail: ${mailErr.message}\n`);
    }

    return ok(citaSegunRol(row.toJSON(), request.headers.get("x-user-role")));
  } catch (err) {
    return serverError(err);
  }
});
