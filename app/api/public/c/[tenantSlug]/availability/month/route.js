import { Op } from "sequelize";
import { withPublicTenant } from "../../../../../../../lib/tenant/publicTenantContext.js";
import { ok, error, notFound, serverError } from "../../../../../../../lib/utils/apiResponse.js";
import {
  buildMadridDate,
  dayHasAnySlot,
  getMadridDayOfWeek,
  getMadridTodayMidnight,
  pickAvailabilitiesForEventType,
} from "../../../../../../../lib/citas/slots.js";
import { ocupaHuecoWhere } from "../../../../../../../lib/citas/booking.js";
import { cargarFestivos } from "../../../../../../../lib/citas/festivos.js";
import { profesionalDeQuienPregunta, recortarSiTieneProfesional } from "../../../../../../../lib/citas/quienPregunta.js";

/**
 * GET /api/public/c/[tenantSlug]/availability/month?eventTypeId=X&year=2026&month=5
 *
 * Devuelve los días del mes que tienen al menos un slot disponible. Usado
 * para pintar el calendario sin hacer N requests.
 *
 * Respuesta: { year, month, availableDays: [2, 3, 5, ...] }
 */
export const GET = withPublicTenant(async (request, _ctx, { slug, tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return notFound("Módulo no disponible");

    const { searchParams } = new URL(request.url);
    const eventTypeId = searchParams.get("eventTypeId");
    const year = parseInt(searchParams.get("year") || "", 10);
    const month = parseInt(searchParams.get("month") || "", 10);

    if (!eventTypeId) return error("eventTypeId es obligatorio");
    if (!Number.isInteger(year) || year < 1970 || year > 9999) return error("year inválido");
    if (!Number.isInteger(month) || month < 1 || month > 12) return error("month inválido");

    const { EventType, Availability, Booking } = tenantModels;
    const eventType = await EventType.findOne({ where: { id: eventTypeId, active: true } });
    if (!eventType) return notFound("EventType no encontrado o inactivo");
    if (!Array.isArray(eventType.modalities) || !eventType.modalities.includes("online")) {
      return notFound("EventType no disponible online");
    }

    const now = new Date();
    const todayStart = getMadridTodayMidnight(now);
    const maxBoundary = new Date(todayStart.getTime() + eventType.maxAdvanceDays * 24 * 60 * 60 * 1000);

    // Cargar TODAS las availabilities relevantes (cualquier día de la semana)
    const allAvailabilities = await Availability.findAll();
    const allAvailabilitiesJson = allAvailabilities.map((a) => a.toJSON());

    // Bookings activos que solapan con el mes solicitado +/- 1 día
    const monthStart = buildMadridDate(year, month, 1, 0, 0);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const monthEnd = buildMadridDate(year, month, daysInMonth, 23, 59);

    // Misma condición de ocupación que /availability y que la creación de
    // reservas (ver ocupaHuecoWhere): las reservas provisionales caducadas no
    // deben pintar un día como lleno.
    const existingBookings = await Booking.findAll({
      where: {
        ...ocupaHuecoWhere(now),
        scheduledAt: {
          [Op.gte]: new Date(monthStart.getTime() - 24 * 60 * 60 * 1000),
          [Op.lt]: new Date(monthEnd.getTime() + 24 * 60 * 60 * 1000),
        },
      },
      attributes: ["id", "scheduledAt", "duration"],
    });
    const existingBookingsJson = existingBookings.map((b) => b.toJSON());

    // Festivos del centro: el widget no puede ofrecer hueco un día cerrado.
    const festivos = await cargarFestivos(tenantModels);

    /*
     * Si quien mira tiene profesional asignada, el mes se pinta con SUS días
     * (06/08/2026). Sin esto, el calendario marcaría en verde un día que al
     * abrirlo aparece sin un solo hueco: peor que no marcarlo.
     *
     * Se resuelve UNA vez para el mes entero, no día a día: son 28-31 vueltas.
     */
    const suya = await profesionalDeQuienPregunta(tenantModels, request, slug);

    const availableDays = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const dayStart = buildMadridDate(year, month, day, 0, 0);
      if (dayStart < todayStart) continue;
      if (dayStart > maxBoundary) continue;

      const dayOfWeek = getMadridDayOfWeek(dayStart);
      const applicable = await recortarSiTieneProfesional(
        tenantModels,
        pickAvailabilitiesForEventType(allAvailabilitiesJson, eventType.id, dayOfWeek),
        suya,
        dayOfWeek
      );
      if (applicable.length === 0) continue;

      const has = dayHasAnySlot({
        eventType: eventType.toJSON(),
        availabilities: applicable,
        date: { year, month, day },
        existingBookings: existingBookingsJson,
        now,
        blockedDates: festivos,
      });
      if (has) availableDays.push(day);
    }

    return ok({ year, month, availableDays });
  } catch (err) {
    return serverError(err);
  }
});
