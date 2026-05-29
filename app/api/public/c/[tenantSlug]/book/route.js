import { withPublicTenant } from "../../../../../../lib/tenant/publicTenantContext.js";
import { created, error, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import {
  normalizeString,
  normalizeEmail,
  isValidEmail,
} from "../../../../../../lib/citas/validation.js";
import { findBookingOverlap } from "../../../../../../lib/citas/booking.js";
import { logCitasAudit } from "../../../../../../lib/citas/audit.js";
import {
  getMadridDayOfWeek,
  getMadridParts,
  getMadridTodayMidnight,
  pickAvailabilitiesForEventType,
  timeStrToMinutes,
} from "../../../../../../lib/citas/slots.js";

/**
 * POST /api/public/c/[tenantSlug]/book
 *
 * Body: { eventTypeId, scheduledAt, clientName, clientEmail, clientPhone, additionalData? }
 *
 * Crea un Booking desde la landing pública. Solo modalidad 'online'.
 */
export const POST = withPublicTenant(async (request, _ctx, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return notFound("Módulo no disponible");
    const ip = request.headers.get("x-forwarded-for") ?? null;

    const { EventType, Availability, Booking } = tenantModels;

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const eventTypeId = normalizeString(body.eventTypeId);
    if (!eventTypeId) return error("eventTypeId es obligatorio");

    const eventType = await EventType.findOne({ where: { id: eventTypeId, active: true } });
    if (!eventType) return notFound("EventType no encontrado o inactivo");
    if (!Array.isArray(eventType.modalities) || !eventType.modalities.includes("online")) {
      return notFound("EventType no disponible online");
    }

    const clientName = normalizeString(body.clientName);
    if (!clientName) return error("clientName es obligatorio", 422);

    const clientEmail = normalizeEmail(body.clientEmail);
    if (!clientEmail || !isValidEmail(clientEmail)) return error("clientEmail inválido", 422);

    const clientPhone = normalizeString(body.clientPhone);
    if (!clientPhone) return error("clientPhone es obligatorio", 422);

    const additionalData = body.additionalData != null ? String(body.additionalData).trim() : null;
    if (eventType.additionalDataRequired && (!additionalData || additionalData === "")) {
      return error("additionalData es obligatorio para este tipo de cita", 422);
    }

    if (!body.scheduledAt) return error("scheduledAt es obligatorio", 422);
    const scheduledAt = new Date(body.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) return error("scheduledAt inválido", 422);

    const now = new Date();

    // Validar antelación mínima
    const minNoticeMs = (eventType.minNoticeHours ?? 0) * 60 * 60 * 1000;
    if (scheduledAt.getTime() < now.getTime() + minNoticeMs) {
      return error("La cita no respeta la antelación mínima", 422);
    }

    const todayStart = getMadridTodayMidnight(now);
    const maxBoundary = new Date(todayStart.getTime() + eventType.maxAdvanceDays * 24 * 60 * 60 * 1000);
    if (scheduledAt > maxBoundary) {
      return error("La cita excede el máximo de días de antelación", 422);
    }

    // Validar que cae dentro de una Availability del día
    const dayOfWeek = getMadridDayOfWeek(scheduledAt);
    const allDayAvailabilities = await Availability.findAll({ where: { dayOfWeek } });
    const applicable = pickAvailabilitiesForEventType(
      allDayAvailabilities.map((a) => a.toJSON()),
      eventType.id,
      dayOfWeek
    );
    if (applicable.length === 0) {
      return error("No hay disponibilidad ese día", 422);
    }

    const { hour: hMadrid, minute: mMadrid } = getMadridParts(scheduledAt);
    const scheduledMin = hMadrid * 60 + mMadrid;
    const endMin = scheduledMin + eventType.duration;

    let withinSlot = false;
    for (const av of applicable) {
      const s = timeStrToMinutes(av.startTime);
      const e = timeStrToMinutes(av.endTime);
      if (s == null || e == null) continue;
      if (scheduledMin >= s && endMin <= e) {
        withinSlot = true;
        break;
      }
    }
    if (!withinSlot) {
      return error("La hora seleccionada no está dentro de la disponibilidad", 422);
    }

    // Solapamiento con otros bookings activos
    const overlap = await findBookingOverlap(Booking, {
      scheduledAt,
      duration: eventType.duration,
    });
    if (overlap) {
      return error("Esa hora ya no está disponible, por favor elige otra", 409);
    }

    const row = await Booking.create({
      eventTypeId: eventType.id,
      clientName,
      clientEmail,
      clientPhone,
      additionalData,
      scheduledAt,
      duration: eventType.duration,
      modality: "online",
      meetUrl: eventType.meetUrl,
      status: "confirmed",
    });

    await logCitasAudit({
      tenantId: tenant.id,
      userId: null,
      action: "citas.booking_created",
      entity: "Booking",
      entityId: row.id,
      before: null,
      after: { ...row.toJSON(), source: "landing" },
      ip,
    });

    return created({
      booking: {
        id: row.id,
        scheduledAt: row.scheduledAt.toISOString(),
        duration: row.duration,
        eventTypeName: eventType.name,
        eventTypeColor: eventType.color,
        meetUrl: row.meetUrl,
        cancellationToken: row.cancellationToken,
        clientEmail: row.clientEmail,
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
