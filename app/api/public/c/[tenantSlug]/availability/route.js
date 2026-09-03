import { Op } from "sequelize";
import { withPublicTenant } from "../../../../../../lib/tenant/publicTenantContext.js";
import { reservaOnlineCerrada } from "../../../../../../lib/citas/puertaReserva.js";
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
import { cargarFestivos } from "../../../../../../lib/citas/festivos.js";
import { cargarAusencias, restarAusencias } from "../../../../../../lib/citas/ausencias.js";
import { profesionalDeQuienPregunta, recortarSiTieneProfesional } from "../../../../../../lib/citas/quienPregunta.js";
import { conHorarioPropio } from "../../../../../../lib/citas/horarioPropio.js";

/**
 * GET /api/public/c/[tenantSlug]/availability?eventTypeId=X&date=YYYY-MM-DD
 *
 * Devuelve los slots libres para un EventType en una fecha concreta.
 *
 * Respuesta:
 *   { slots: [{ time: "09:00", datetime: "2026-05-30T09:00:00+02:00" }, ...] }
 *   { slots: [], reason: "past" | "too_far" | "no_availability" }
 */
export const GET = withPublicTenant(async (request, _ctx, { slug, tenant, tenantModels, hasModule, hasFeatureFlag }) => {
  try {
    if (!hasModule("citas")) return notFound("Módulo no disponible");
    // El centro puede no dar cita por internet (08/08/2026). Va JUSTO debajo
    // del módulo y devuelve lo mismo que él —un 404— para no distinguir «no
    // contratado» de «cerrado» desde fuera. Ver lib/citas/puertaReserva.js.
    if (reservaOnlineCerrada(tenant)) return notFound("Módulo no disponible");

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
    let applicable = pickAvailabilitiesForEventType(
      allDayAvailabilities.map((a) => a.toJSON()),
      eventType.id,
      dayOfWeek
    );

    /*
     * Los huecos de SU profesional (06/08/2026, Rodrigo). Si quien pregunta
     * tiene una asignada en su ficha, el horario del centro se recorta al
     * suyo: en un centro con equipo, ofrecerle los de otra es ofrecerle una
     * cita que no le corresponde.
     *
     * Se identifica por el email que ya trae la petición del portal. Sin email
     * —agenda anónima— no hay a quién mirar y se enseña la del centro, que es
     * como ha funcionado siempre.
     *
     * Best-effort a propósito: si algo falla aquí, se sirven los huecos del
     * centro. Una paciente sin poder pedir cita es mucho peor que una que ve
     * algún hueco de más y se lo reajustan por teléfono.
     */
    const suya = await profesionalDeQuienPregunta(tenantModels, request, slug);
    const horarioPropio = conHorarioPropio(hasFeatureFlag);
    applicable = await recortarSiTieneProfesional(tenantModels, applicable, suya, dayOfWeek, { horarioPropio });

    /*
     * «Vacaciones» (06/08/2026): los tramos en que su profesional no está —o en
     * que no está nadie— se restan de lo que queda. Va DESPUÉS de recortar al
     * horario: primero cuándo trabaja, luego cuándo falta.
     */
    const bloqueos = await cargarAusencias(tenantModels, {
      desde: new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day - 1)),
      hasta: new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + 2)),
      profesionalId: suya,
    });
    applicable = restarAusencias(applicable, bloqueos, parsed);

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

    // Festivos del centro: un día cerrado no ofrece ningún hueco.
    const festivos = await cargarFestivos(tenantModels);

    const rawSlots = generateSlotsForDay({
      eventType: eventType.toJSON(),
      availabilities: applicable,
      date: parsed,
      existingBookings: existingBookings.map((b) => b.toJSON()),
      now,
      blockedDates: festivos,
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
