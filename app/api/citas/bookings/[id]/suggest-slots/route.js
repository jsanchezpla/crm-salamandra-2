import { Op } from "sequelize";
import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { findBookingOverlap, ocupaHuecoWhere } from "../../../../../../lib/citas/booking.js";
import { buildCandidates, chooseSlots, suggestFakeEnabled } from "../../../../../../lib/citas/suggestSlots.js";
import { cargarAusencias } from "../../../../../../lib/citas/ausencias.js";
import { bloqueosQueChocan } from "../../../../../../lib/citas/choqueConBloqueos.js";
import { duracionDeContacto } from "../../../../../../lib/citas/slots.js";
import { modoDeIa } from "../../../../../../lib/ai/modoDeIa.js";
import { resolveCurrentTeamMemberId } from "../../../../../../lib/team/currentTeamMember.js";
import { cargarFestivos } from "../../../../../../lib/citas/festivos.js";
import { vetoAi } from "../../../../../../lib/ai/aiAccess.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

// POST /api/citas/bookings/[id]/suggest-slots
// Propone 3 horarios para reprogramar una cita. La IA la aplica el CENTRO (admin);
// ámbito "professional" (solo el profesional de la cita) o "company" (todo el equipo).
export const POST = withTenant(async (request, { params }, ctx) => {
  try {
    if (!ctx.hasModule("citas")) return forbidden("Módulo citas no activo");
    const role = request.headers.get("x-user-role") ?? "user";
    const isAdmin = ADMIN_ROLES.has(role);

    const { id } = await params;
    const { Booking, EventType, TeamMember, TeamMemberHours, Availability, Patient } = ctx.tenantModels;

    const booking = await Booking.findByPk(id);
    if (!booking) return notFound("Cita no encontrada");

    // Un profesional no-admin solo puede pedir horarios para SUS propias citas,
    // y siempre en ámbito "este profesional" (no reorganiza a todo el centro).
    if (!isAdmin) {
      const myMemberId = await resolveCurrentTeamMemberId(request, ctx.tenantModels);
      if (!myMemberId || !booking.teamMemberId || myMemberId !== booking.teamMemberId) {
        return forbidden("Solo puedes pedir horarios para tus propias citas");
      }
    }

    const eventType = await EventType.findByPk(booking.eventTypeId);
    if (!eventType) return error("La cita no tiene un tipo válido", 422);
    // El hueco tiene que caberle a ESTA cita, que no siempre dura lo que su tipo
    // (un diagnóstico de 180 con un tipo de 60). La rejilla sigue siendo la del
    // tipo: ver `generateSlotsForDay` (13/09/2026).
    const duracion = booking.duration || duracionDeContacto(eventType);

    let body = {};
    try { body = await request.json(); } catch { /* body opcional */ }
    const scope = isAdmin && body?.scope === "company" ? "company" : "professional";
    const horizonDays = Math.min(60, Math.max(1, Number(body?.horizonDays) || 14));
    const preferences = typeof body?.preferences === "string" ? body.preferences.slice(0, 300) : "";
    const hasTeam = ctx.tenantHasModule ? ctx.tenantHasModule("team") : ctx.hasModule("team");

    // Miembros a considerar según ámbito.
    let members = [];
    if (scope === "professional") {
      if (!booking.teamMemberId) {
        return error("La cita no tiene profesional asignado. Usa el ámbito 'todo el centro'.", 422);
      }
      const tm = TeamMember ? await TeamMember.findByPk(booking.teamMemberId, { attributes: ["id", "displayName"] }) : null;
      members = [{ id: booking.teamMemberId, name: tm?.displayName || "Profesional" }];
    } else if (TeamMember && hasTeam) {
      const rows = await TeamMember.findAll({ where: { status: "active" }, attributes: ["id", "displayName"] });
      members = rows.map((r) => ({ id: r.id, name: r.displayName }));
    }
    if (members.length === 0) members = [{ id: null, name: "Centro" }]; // sin módulo team → calendario único

    // Horario propio de cada miembro.
    for (const m of members) {
      m.hours = [];
      if (m.id && TeamMemberHours) {
        const hrs = await TeamMemberHours.findAll({ where: { teamMemberId: m.id }, attributes: ["dayOfWeek", "startTime", "endTime"] });
        m.hours = hrs.map((h) => ({ dayOfWeek: h.dayOfWeek, startTime: h.startTime, endTime: h.endTime }));
      }
    }

    // Citas que OCUPAN su hueco en el horizonte: se reparten por miembro (una sin
    // profesional bloquea a todos). Con el mismo criterio que el guardado
    // (`ocupaHuecoWhere`, que libera los carritos abandonados) y con tope: lo
    // que empieza después del último día mirado no puede tapar ningún hueco.
    const DIA_MS = 24 * 60 * 60 * 1000;
    const now = new Date();
    const fin = new Date(now.getTime() + (horizonDays + 1) * DIA_MS);
    const activeBookings = await Booking.findAll({
      where: { ...ocupaHuecoWhere(now), scheduledAt: { [Op.gte]: now, [Op.lt]: fin }, id: { [Op.ne]: booking.id } },
      attributes: ["scheduledAt", "duration", "teamMemberId"],
    });
    for (const m of members) {
      m.bookings = activeBookings
        .filter((b) => b.teamMemberId === m.id || b.teamMemberId == null)
        .map((b) => ({ scheduledAt: b.scheduledAt, duration: b.duration }));
    }

    // Fallback de horario para profesionales sin horario propio: Availability global.
    let centerAvailabilities = [];
    if (Availability) {
      const av = await Availability.findAll({ where: { eventTypeId: null }, attributes: ["dayOfWeek", "startTime", "endTime"] });
      centerAvailabilities = av.map((a) => ({ dayOfWeek: a.dayOfWeek, startTime: a.startTime, endTime: a.endTime, eventTypeId: null }));
    }

    // 1) Candidatos VÁLIDOS (horario propio − citas − festivos − bloqueos).
    // Un festivo del centro no puede salir como hueco sugerido, y un tramo
    // bloqueado de la agenda (vacaciones, reunión, «libre pacientes»…) tampoco:
    // antes solo se miraban los festivos y en nutri_laura 7 de 143 candidatos (y
    // 1 de las 3 tarjetas) caían dentro de un bloqueo (13/09/2026). Cuentan como
    // una cita más, sin correr la rejilla: `lib/citas/choqueConBloqueos.js`.
    const festivos = await cargarFestivos(ctx.tenantModels);
    const bloqueos = await cargarAusencias(ctx.tenantModels, {
      desde: now,
      hasta: fin,
      profesionalIds: members.map((m) => m.id).filter(Boolean),
    });
    const candidates = buildCandidates({ eventType, duracion, members, horizonDays, now, centerAvailabilities, blockedDates: festivos, bloqueos });
    if (candidates.length === 0) {
      return ok({ suggestions: [], model: "none", note: "No hay huecos libres en el horizonte (ya descontadas las citas, los festivos y los bloqueos). Configura el horario de los terapeutas o amplía los días." });
    }

    // 2) La IA elige 3 (o simulado / sin-ia).
    let patientName = null;
    if (booking.patientId && Patient) {
      const p = await Patient.findByPk(booking.patientId, { attributes: ["firstName", "lastName"] });
      if (p) patientName = `${p.firstName} ${p.lastName}`.trim();
    }
    // Simulado en las cuatro demos o por entorno; `vetoAi` solo si de verdad se
    // va a llamar a la IA (`lib/ai/modoDeIa.js`, 14/09/2026). Si dice que no,
    // su 403/429 se devuelve tal cual.
    const ia = modoDeIa(ctx, { simuladoPorEntorno: suggestFakeEnabled() });
    if (ia.gastaIa) {
      const veto = await vetoAi(ctx, request, "sugerir horarios de cita con IA");
      if (veto) return veto;
    }
    let chosen;
    try {
      chosen = await chooseSlots({
        candidates,
        context: { serviceName: eventType.name, duration: duracion, patientName, preferences, scope },
        apiKey: ia.apiKey, model: ia.model, forceFake: ia.simulado,
      });
    } catch (e) {
      // Un fallo de la IA ya lo recoge `chooseSlots` con su `avisoIA`
      // (13/09/2026); lo que llega aquí es otra cosa —un fallo nuestro—, y
      // tampoco se calla. Sin culpar a la IA: no ha sido ella.
      console.error("[citas:suggest-slots]", e?.name, e?.message);
      chosen = { model: "sin-ia", suggestions: [], avisoIA: "No se han podido elegir los huecos; estos son huecos libres elegidos sin ayuda." };
    }
    if (!chosen.suggestions?.length) {
      chosen = { ...chosen, model: chosen.model || "sin-ia", suggestions: candidates.slice(0, 3).map((c) => ({ slotId: c.slotId, reason: `Hueco libre: ${c.label}.` })) };
    }

    // 3) Mapear + RE-VALIDAR cada propuesta (tercera red: por si entró otra cita).
    // Mide con la duración de ESTA cita, y un bloqueo que aplica a esa persona
    // (o del centro) la descarta, con la misma regla que el generador.
    const byId = new Map(candidates.map((c) => [c.slotId, c]));
    const suggestions = [];
    const pushValid = async (c, reason) => {
      if (bloqueosQueChocan(bloqueos, { inicio: new Date(c.datetime), duracion, profesionalId: c.teamMemberId }).length) return;
      const overlap = await findBookingOverlap(Booking, {
        scheduledAt: new Date(c.datetime), duration: duracion, excludeId: booking.id, teamMemberId: c.teamMemberId,
      });
      if (overlap) return;
      if (suggestions.some((x) => x.datetime === c.datetime && x.teamMemberId === c.teamMemberId)) return;
      suggestions.push({ datetime: c.datetime, label: c.label, teamMemberId: c.teamMemberId, teamMemberName: c.teamMemberName, reason });
    };
    for (const s of chosen.suggestions) {
      const c = byId.get(s.slotId);
      if (c) await pushValid(c, s.reason);
      if (suggestions.length >= 3) break;
    }
    for (const c of candidates) {
      if (suggestions.length >= 3) break;
      await pushValid(c, `Hueco libre: ${c.label}.`);
    }

    return ok({ suggestions: suggestions.slice(0, 3), model: chosen.model, scope, avisoIA: chosen.avisoIA ?? null });
  } catch (err) {
    return serverError(err);
  }
});
