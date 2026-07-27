import { logCitasAudit } from "./audit.js";
import { reembolsarCitaSiProcede } from "./reembolsoCita.js";

/**
 * Cancela una fila `Booking` ya cargada, centralizando las reglas de "cuándo es
 * cancelable" + el update + la auditoría, para que los distintos puntos de
 * cancelación no divergan:
 *   - cancelación por `cancellationToken` desde el email (endpoint `cancel/[token]`),
 *   - cancelación por `id` + ownership desde el portal SSO (endpoint `citas-portal/cancel/[id]`).
 *
 * El caller es responsable de CARGAR la fila (por token, o por id + verificación
 * de propiedad por email). Este helper NO envía email — mantiene el comportamiento
 * observable del endpoint de cancelación existente.
 *
 * Si se le pasa `ctx`, aplica además la política de reembolso (ver
 * `politicaReembolso.js`). Sin `ctx` no devuelve nada, que es el comportamiento
 * que tenían las citas gratuitas de siempre.
 *
 * Lanza Error con `.code`:
 *   - "ALREADY_CANCELLED" (→410): la cita ya estaba cancelada.
 *   - "ALREADY_PAST"      (→410): la cita ya ha pasado.
 */
export async function cancelBookingRow({
  booking,
  tenantId,
  reason = null,
  source,
  ip = null,
  ctx = null,
  quienCancela = "cliente",
}) {
  if (booking.status === "cancelled") {
    const err = new Error("ALREADY_CANCELLED");
    err.code = "ALREADY_CANCELLED";
    throw err;
  }
  if (new Date(booking.scheduledAt) <= new Date()) {
    const err = new Error("ALREADY_PAST");
    err.code = "ALREADY_PAST";
    throw err;
  }

  const before = booking.toJSON();
  const cleanReason = reason != null ? String(reason).trim() || null : null;

  await booking.update({
    status: "cancelled",
    cancelledAt: new Date(),
    cancellationReason: cleanReason,
  });

  // Devolución del dinero según la política. Va DESPUÉS de cancelar y es
  // best-effort: si Stripe no contesta, la cita queda cancelada igualmente.
  let reembolso = null;
  if (ctx) {
    reembolso = await reembolsarCitaSiProcede(ctx, booking, { quienCancela });
  }

  await logCitasAudit({
    tenantId,
    userId: null,
    action: "citas.booking_cancelled",
    entity: "Booking",
    entityId: booking.id,
    before,
    after: {
      status: "cancelled",
      cancellationReason: cleanReason,
      source,
      ...(reembolso ? { reembolso } : {}),
    },
    ip,
  });

  return { ok: true, reembolso };
}
