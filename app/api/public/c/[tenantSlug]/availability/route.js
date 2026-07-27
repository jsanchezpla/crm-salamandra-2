import { Op } from "sequelize";
import { withPublicTenant } from "../../../../../../lib/tenant/publicTenantContext.js";
import { ok, error, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { ocupaHuecoWhere } from "../../../../../../lib/citas/booking.js";
import {
  buildMadridDate,
  generateSlotsForDay,
  getMadridDayOfWeek,
  getMadridTodayMidnight,
  parseISODate,
  pickAvailabilitiesForEventType,
  toMadridISOString,
} from "../../../../../../lib/citas/slots.js";

/**
 * GET /api/public/c/[tenantSlug]/availability?eventTypeId=X&date=YYYY-MM-DD
 *
 * Devuelve los slots libres para un EventType en una fecha concreta.
 *
 * Respuesta:
 *   { slots: [{ time: "09:00", datetime: "2026-05-30T09:00:00+02:00" }, ...] }
 *   { slots: [], reason: "past" | "too_far" | "no_availability" }
 */
export const GET = withPublicTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return notFound("Módulo no disponible");

    const { searchParams } = new URL(request.url);
    const eventTypeId = searchParams.get("eventTypeId");
    const dateStr = searchParams.get("date");

    if (!eventTypeId) return error("eventTypeId es obligatorio");
    if (!dateStr) return error("date es obligatorio (formato YYYY-MM-DD)");

    const parsed = parseISODate(dateStr);
    if (!parsed) return error("date inválido (formato YYYY-MM-DD)");

    const { EventType, Availability, Booking } = tenantModels;
    const eventType = await EventType.findOne({
      where: { id: eventTypeId, active: true },
    });
    if (!eventType) return notFound("EventType no encontrado o inactivo");
    if (!Array.isArray(eventType.modalities) || !eventType.modalities.includes("online")) {
      return notFound("EventType no disponible online");
    }

    const now = new Date();
    const dayStart = buildMadridDate(parsed.year, parsed.month, parsed.day, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const todayStart = getMadridTodayMidnight(now);

    if (dayStart < todayStart) {
      return ok({ slots: [], reason: "past" });
    }

    // maxAdvanceDays: today + max días debe ser >= dayStart
    const maxBoundary = new Date(todayStart.getTime() + eventType.maxAdvanceDays * 24 * 60 * 60 * 1000);
    if (dayStart > maxBoundary) {
      return ok({ slots: [], reason: "too_far" });
    }

    const dayOfWeek = getMadridDayOfWeek(dayStart);

    const allDayAvailabilities = await Availability.findAll({
      where: { dayOfWeek },
    });
    const applicable = pickAvailabilitiesForEventType(
      allDayAvailabilities.map((a) => a.toJSON()),
      eventType.id,
      dayOfWeek
    );

    if (applicable.length === 0) {
      return ok({ slots: [], reason: "no_availability" });
    }

    // Citas que ocupan hueco y solapan con el día solicitado. La condición sale
    // de `ocupaHuecoWhere` (única fuente de verdad, compartida con la creación de
    // reservas): así una reserva provisional sin pagar y ya caducada NO sigue
    // bloqueando la hora.
    const existingBookings = await Booking.findAll({
      where: {
        ...ocupaHuecoWhere(now),
        scheduledAt: { [Op.gte]: new Date(dayStart.getTime() - 24 * 60 * 60 * 1000), [Op.lt]: new Date(dayEnd.getTime() + 24 * 60 * 60 * 1000) },
      },
      attributes: ["id", "scheduledAt", "duration"],
    });

    const rawSlots = generateSlotsForDay({
      eventType: eventType.toJSON(),
      availabilities: applicable,
      date: parsed,
      existingBookings: existingBookings.map((b) => b.toJSON()),
      now,
    });

    const slots = rawSlots.map((s) => ({
      time: s.time,
      datetime: toMadridISOString(new Date(s.datetime)),
    }));

    return ok({ slots });
  } catch (err) {
    return serverError(err);
  }
});
