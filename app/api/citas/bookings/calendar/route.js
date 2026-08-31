import { Op } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, forbidden, error, serverError } from "../../../../../lib/utils/apiResponse.js";
import { resolveCurrentTeamMemberId } from "../../../../../lib/team/currentTeamMember.js";
import { noEsCarritoAbandonado } from "../../../../../lib/citas/booking.js";
import { veTodaLaAgenda, soloLoSuyo, filtroDeProfesionales } from "../../../../../lib/citas/visibilidad.js";

const STATUS_COLOR_DIM = {
  cancelled: "#9ca3af",
  no_show: "#a78bfa",
  completed: "#475569",
};


/**
 * GET /api/citas/bookings/calendar?start=ISO&end=ISO
 *   &eventTypeIds=csv     (opcional) filtra por tipo de cita
 *   &teamMemberIds=csv    (opcional, SOLO admin) filtra por profesional(es).
 *                         Admite `sin-asignar` como uno más de la lista, para
 *                         pedir las citas que aún no son de nadie.
 *
 * Devuelve bookings en formato FullCalendar para el rango pedido.
 *
 * Visibilidad (tenants con módulo team), en lib/citas/visibilidad.js:
 *   · Admin/jefe: ve las citas de TODO el equipo; puede acotar con teamMemberIds.
 *   · Resto: ve SOLO sus propias citas… salvo que el tenant tenga
 *     `settings.citas.agendaCompartida`, y entonces ve (y filtra) la de todos.
 *
 * Color del evento: por PERSONA (avatar_color del profesional) si la cita tiene
 * profesional asignado; si no, el color del tipo de cita. Las
 * canceladas/no_show/completadas van apagadas.
 */
export const GET = withTenant(async (request, _ctx, { tenant, tenantModels, hasModule, tenantHasModule }) => {
  try {
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");

    const { Booking, EventType, TeamMember } = tenantModels;
    const { searchParams } = new URL(request.url);
    const start = searchParams.get("start");
    const end = searchParams.get("end");

    if (!start || !end) return error("start y end son obligatorios");
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return error("start/end inválidos");
    }

    // Sin el filtro de carritos abandonados, el calendario pintaba como cita una
    // reserva que nadie llegó a pagar y cuyo hueco ya está libre para otros.
    const where = {
      scheduledAt: { [Op.gte]: startDate, [Op.lt]: endDate },
      ...noEsCarritoAbandonado(),
    };

    const eventTypeIds = searchParams.get("eventTypeIds"); // CSV opcional
    if (eventTypeIds) {
      const ids = eventTypeIds.split(",").map((s) => s.trim()).filter(Boolean);
      if (ids.length > 0) where.eventTypeId = { [Op.in]: ids };
    }

    // ⚠️ `tenantHasModule` y NO `hasModule`: la pregunta es si el CENTRO tiene
    // equipo, no si quien mira puede entrar en la pantalla de Equipo. El porqué,
    // en lib/citas/visibilidad.js — con `hasModule` esto NO se ejecutaba.
    const teamOn = tenantHasModule("team");
    if (teamOn) {
      const userRole = request.headers.get("x-user-role") ?? "user";
      // Con agenda compartida, una terapeuta ve —y filtra— la agenda entera
      // igual que dirección: es lo que pidió Aumenta para cuadrar
      // recuperaciones entre compañeras (lib/citas/visibilidad.js).
      if (veTodaLaAgenda({ tenant, role: userRole })) {
        // El jefe ve a todos; puede filtrar a uno o varios profesionales, y
        // `sin-asignar` es uno más de la lista. Filtrar por una persona enseña
        // SOLO las suyas: hasta el 25/08/2026 se colaban además las 1.827 sin
        // profesional, y en una semana de Aumenta eran 70 de las 103 en
        // pantalla. El porqué entero, en lib/citas/filtros.js.
        const filtro = filtroDeProfesionales(searchParams.get("teamMemberIds"));
        if (filtro) where.teamMemberId = filtro;
      } else {
        // Un profesional ve SU agenda y las citas que no son de nadie (la regla
        // entera, con su porqué, en lib/citas/visibilidad.js).
        const myId = await resolveCurrentTeamMemberId(request, tenantModels);
        where.teamMemberId = soloLoSuyo(myId);
      }
    }

    // `sessionsCount` para poder pintar «3/10»: el número de sesión lo lleva la
    // cita, pero el total es del tipo de cita.
    const include = [
      { model: EventType, as: "eventType", attributes: ["id", "name", "color", "sessionsCount"] },
    ];
    if (teamOn) {
      include.push({ model: TeamMember, as: "teamMember", attributes: ["id", "displayName", "avatarColor"] });
    }

    const rows = await Booking.findAll({
      where,
      include,
      order: [["scheduledAt", "ASC"]],
    });

    const events = rows.map((b) => {
      const startIso = new Date(b.scheduledAt);
      const endIso = new Date(startIso.getTime() + b.duration * 60 * 1000);
      const personColor = teamOn && b.teamMember?.avatarColor ? b.teamMember.avatarColor : null;
      const baseColor = personColor || b.eventType?.color || "#3F6E5B";
      const color = STATUS_COLOR_DIM[b.status] || baseColor;
      // Solo las citas ACTIVAS se pueden arrastrar para reprogramar.
      const arrastrable = b.status !== "cancelled" && b.status !== "no_show" && b.status !== "completed";
      // Bono: «3/10» delante del nombre. Va en el TÍTULO y no solo en el
      // detalle porque el sentido de esto es verlo de un vistazo en la rejilla,
      // sin abrir cita por cita, para saber por dónde va cada persona.
      const total = Number(b.eventType?.sessionsCount) || 0;
      const numero = Number(b.sessionNumber) || 0;
      const sesion = numero > 0 ? (total > 1 ? `${numero}/${total}` : `${numero}`) : null;

      return {
        id: b.id,
        title: sesion ? `${sesion} · ${b.clientName}` : b.clientName,
        start: startIso.toISOString(),
        end: endIso.toISOString(),
        backgroundColor: color,
        borderColor: color,
        startEditable: arrastrable,
        extendedProps: {
          status: b.status,
          modality: b.modality,
          // Para el menú contextual (31/08/2026): saltar a la ficha y cobrar
          // necesitan saber DE QUIÉN es la cita sin otro viaje al servidor.
          clientId: b.clientId ?? null,
          patientId: b.patientId ?? null,
          clientEmail: b.clientEmail,
          clientPhone: b.clientPhone,
          eventTypeId: b.eventTypeId,
          eventTypeName: b.eventType?.name ?? null,
          duration: b.duration,
          teamMemberId: b.teamMemberId ?? null,
          teamMemberName: teamOn ? (b.teamMember?.displayName ?? null) : null,
          // El nombre del cliente SIN el «3/10» delante, para quien lo necesite
          // limpio (el panel de detalle, un buscador).
          clientName: b.clientName,
          packId: b.packId ?? null,
          sessionNumber: numero || null,
          sessionsTotal: total > 1 ? total : null,
          sessionLabel: sesion,
        },
      };
    });

    return ok(events);
  } catch (err) {
    return serverError(err);
  }
});
