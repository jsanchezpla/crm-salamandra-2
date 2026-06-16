import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, noContent, serverError } from "../../../../../lib/utils/apiResponse.js";
import {
  normalizeString,
  normalizeEmail,
  isValidEmail,
  VALID_MODALITIES,
} from "../../../../../lib/citas/validation.js";
import { logCitasAudit } from "../../../../../lib/citas/audit.js";
import { findBookingOverlap } from "../../../../../lib/citas/booking.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const VALID_STATUS = new Set(["pending", "confirmed", "completed", "cancelled", "no_show"]);

// ───────────────────────────────────────────────────────────────────────────
// GET /api/citas/bookings/[id]
// ───────────────────────────────────────────────────────────────────────────
export const GET = withTenant(async (_request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");
    const { id } = await params;
    const { Booking, EventType } = tenantModels;
    const row = await Booking.findByPk(id, {
      include: [{ model: EventType, as: "eventType" }],
    });
    if (!row) return notFound("Cita no encontrada");
    return ok(row.toJSON());
  } catch (err) {
    return serverError(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// PATCH /api/citas/bookings/[id]
// ───────────────────────────────────────────────────────────────────────────
export const PATCH = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");
    const userRole = request.headers.get("x-user-role") ?? "user";
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;
    if (!ADMIN_ROLES.has(userRole)) return forbidden("Solo admin puede editar citas");

    const { id } = await params;
    const { Booking, EventType } = tenantModels;
    const row = await Booking.findByPk(id);
    if (!row) return notFound("Cita no encontrada");

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const before = row.toJSON();
    const updates = {};

    if ("clientName" in body) {
      const v = normalizeString(body.clientName);
      if (!v) return error("clientName no puede ser vacío");
      updates.clientName = v;
    }
    if ("clientEmail" in body) {
      const v = normalizeEmail(body.clientEmail);
      if (!v || !isValidEmail(v)) return error("clientEmail inválido");
      updates.clientEmail = v;
    }
    if ("clientPhone" in body) {
      const v = normalizeString(body.clientPhone);
      if (!v) return error("clientPhone no puede ser vacío");
      updates.clientPhone = v;
    }
    if ("additionalData" in body) {
      updates.additionalData = body.additionalData != null ? String(body.additionalData) : null;
    }
    if ("notes" in body) {
      updates.notes = body.notes != null ? String(body.notes) : null;
    }

    let modalityFinal = row.modality;
    if ("modality" in body) {
      const v = String(body.modality || "").toLowerCase();
      if (!VALID_MODALITIES.includes(v)) return error("modality inválida");
      const eventType = await EventType.findByPk(row.eventTypeId);
      if (eventType && !eventType.modalities.includes(v)) {
        return error(`modality '${v}' no está permitida para este tipo de cita`);
      }
      updates.modality = v;
      modalityFinal = v;
      // Re-snapshot meetUrl
      if (eventType) {
        updates.meetUrl = v === "online" ? eventType.meetUrl : null;
      }
    }

    if ("scheduledAt" in body) {
      const v = new Date(body.scheduledAt);
      if (Number.isNaN(v.getTime())) return error("scheduledAt inválido");
      updates.scheduledAt = v;
    }

    // Cambio de status
    let statusChanged = false;
    let oldStatus = row.status;
    if ("status" in body) {
      const v = body.status;
      if (!VALID_STATUS.has(v)) return error("status inválido");
      // Bloqueo de regresión a 'pending': una cita confirmada/cancelada/
      // completada/no_show NUNCA puede volver a la lista de espera —
      // confundiría al paciente y dispararía emails contradictorios. La
      // creación con status='pending' va por el endpoint público /book
      // según el feature flag; el admin no debería forzar regresiones
      // desde aquí.
      if (v === "pending" && row.status !== "pending") {
        return forbidden(
          "Una cita no puede volver al estado pendiente una vez confirmada o procesada."
        );
      }
      if (v !== row.status) statusChanged = true;
      updates.status = v;
      if (v === "cancelled") {
        updates.cancelledAt = updates.cancelledAt ?? new Date();
        if ("cancellationReason" in body) {
          updates.cancellationReason = body.cancellationReason != null ? String(body.cancellationReason) : null;
        }
      } else {
        // si vuelve a confirmar/completar limpia cancellation
        if (row.cancelledAt) updates.cancelledAt = null;
        if (row.cancellationReason) updates.cancellationReason = null;
      }
    } else if ("cancellationReason" in body) {
      updates.cancellationReason = body.cancellationReason != null ? String(body.cancellationReason) : null;
    }

    // Validar solapamiento si cambia scheduledAt y la cita queda activa
    const scheduledFinal = updates.scheduledAt ?? row.scheduledAt;
    const statusFinal = updates.status ?? row.status;
    if (statusFinal !== "cancelled" && statusFinal !== "no_show") {
      if ("scheduledAt" in updates) {
        const overlap = await findBookingOverlap(Booking, {
          scheduledAt: scheduledFinal,
          duration: row.duration,
          excludeId: row.id,
        });
        if (overlap) {
          return error(`Solapa con otra cita activa el ${overlap.scheduledAt.toISOString?.() ?? overlap.scheduledAt}`, 409);
        }
      }
    }

    await row.update(updates);
    await row.reload();

    await logCitasAudit({
      tenantId: tenant.id,
      userId,
      action: "citas.booking_updated",
      entity: "Booking",
      entityId: row.id,
      before,
      after: row.toJSON(),
      ip,
    });

    if (statusChanged) {
      await logCitasAudit({
        tenantId: tenant.id,
        userId,
        action: "citas.booking_status_changed",
        entity: "Booking",
        entityId: row.id,
        before: { status: oldStatus },
        after: { status: row.status, cancellationReason: row.cancellationReason ?? null },
        ip,
      });
    }

    return ok(row.toJSON());
  } catch (err) {
    return serverError(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// DELETE /api/citas/bookings/[id] — equivale a cancelar
// ───────────────────────────────────────────────────────────────────────────
export const DELETE = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");
    const userRole = request.headers.get("x-user-role") ?? "user";
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;
    if (!ADMIN_ROLES.has(userRole)) return forbidden("Solo admin puede cancelar citas");

    const { id } = await params;
    const { Booking } = tenantModels;
    const row = await Booking.findByPk(id);
    if (!row) return notFound("Cita no encontrada");

    // Permitir pasar ?reason=... en query string para registrar el motivo
    const { searchParams } = new URL(request.url);
    const reason = normalizeString(searchParams.get("reason"));

    if (row.status === "cancelled") return noContent();

    const before = row.toJSON();
    await row.update({
      status: "cancelled",
      cancelledAt: new Date(),
      cancellationReason: reason ?? row.cancellationReason ?? null,
    });

    await logCitasAudit({
      tenantId: tenant.id,
      userId,
      action: "citas.booking_cancelled",
      entity: "Booking",
      entityId: row.id,
      before,
      after: { status: "cancelled", cancellationReason: reason ?? null },
      ip,
    });

    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
