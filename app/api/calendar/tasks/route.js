import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden } from "../../../../lib/utils/apiResponse.js";
import { ForbiddenError, handleRouteError } from "../../../../lib/utils/errors.js";
import { getTenantContext } from "../../../../lib/tenant/tenantResolver.js";
import { Op } from "sequelize";
import { NextResponse } from "next/server";
import { toFCEvent, calendarIncludes, resolveCalendarFks } from "../../../../lib/calendar/calendarEvent.js";
import { fetchProjectEvents } from "../../../../lib/calendar/projectEvents.js";
import {
  revisarEnlace,
  revisarCorreoInvitado,
  limpio,
  toca,
  enviarInvitacion,
} from "../../../../lib/calendar/invitacion.js";

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("calendar")) return forbidden();

  const { CalendarTask } = tenantModels;
  const { searchParams } = new URL(request.url);

  const where = {};
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  if (start && end) {
    where.startDate = { [Op.between]: [start, end] };
  } else if (start) {
    where.startDate = { [Op.gte]: start };
  }

  // Filtros opcionales por cliente / team member.
  const clientId = searchParams.get("clientId");
  const teamMemberId = searchParams.get("teamMemberId");
  if (clientId) where.clientId = clientId;
  if (teamMemberId) where.teamMemberId = teamMemberId;

  const tasks = await CalendarTask.findAll({
    where,
    include: calendarIncludes(tenantModels, hasModule),
    order: [["startDate", "ASC"], ["startTime", "ASC"]],
  });

  // Integración con Proyectos: tarjetas Kanban con fecha límite + hitos, como
  // eventos con extendedProps.kind (el frontend los trata distinto). Se omiten
  // si se filtra por cliente/miembro (son filtros de calendar_tasks) o con
  // ?projects=0 (toggle de la UI).
  let projectEvents = [];
  if (!clientId && !teamMemberId && searchParams.get("projects") !== "0") {
    projectEvents = await fetchProjectEvents({ tenantModels, hasModule, start, end });
  }

  return ok([...tasks.map(toFCEvent), ...projectEvents]);
});

export async function POST(request) {
  try {
    const ctx = await getTenantContext(request);
    if (!ctx.hasModule("calendar")) throw new ForbiddenError();

    const { CalendarTask } = ctx.tenantModels;
    const body = await request.json();

    const { title, notes, priority, status, startDate, startTime, endDate, endTime, allDay } = body;

    if (!title?.trim()) {
      return NextResponse.json({ ok: false, error: "El título es obligatorio" }, { status: 422 });
    }
    if (!startDate) {
      return NextResponse.json({ ok: false, error: "La fecha de inicio es obligatoria" }, { status: 422 });
    }

    const VALID_PRIORITY = ["high", "medium", "low"];
    const VALID_STATUS = ["pending", "done", "cancelled"];

    // FKs opcionales validadas (400 si el id no existe).
    const fk = await resolveCalendarFks(body, ctx.tenantModels, ctx.hasModule);
    if (fk.error) return NextResponse.json({ ok: false, error: fk.error }, { status: 400 });

    // La convocatoria: enlace de videollamada y a quién se le manda. Se valida
    // ANTES de crear nada — un enlace mal pegado no puede dejar el evento
    // guardado a medias y a la persona esperando un correo que no va a llegar.
    const meetUrl = limpio(body.meetUrl);
    const inviteEmail = limpio(body.inviteEmail);
    const malEnlace = revisarEnlace(meetUrl);
    if (malEnlace) return NextResponse.json({ ok: false, error: malEnlace }, { status: 422 });
    const malCorreo = revisarCorreoInvitado(inviteEmail);
    if (malCorreo) return NextResponse.json({ ok: false, error: malCorreo }, { status: 422 });

    const task = await CalendarTask.create({
      title: title.trim(),
      notes: notes?.trim() ?? null,
      priority: VALID_PRIORITY.includes(priority) ? priority : "medium",
      status: VALID_STATUS.includes(status) ? status : "pending",
      startDate,
      startTime: allDay ? null : (startTime || null),
      endDate: endDate || null,
      endTime: allDay ? null : (endTime || null),
      allDay: Boolean(allDay),
      clientId: fk.updates.clientId ?? null,
      teamMemberId: fk.updates.teamMemberId ?? null,
      meetUrl,
      inviteEmail,
    });

    /*
     * La convocatoria sale DESPUÉS de que el evento exista, y su fallo no lo
     * deshace: el evento guardado sin correo se ve igual en el calendario, y
     * perderlo porque falló un email no lo arregla nadie. La pantalla recibe
     * `envio` para poder decir qué pasó de verdad.
     */
    let envio = null;
    if (toca(body, task)) {
      envio = await enviarInvitacion({
        evento: task,
        tenant: ctx.tenant,
        quienConvoca: request.headers.get("x-user-email") || null,
      });
      if (envio.enviado) await task.update({ inviteSentAt: new Date() });
    }

    // Recarga con asociaciones para devolver los nombres al frontend.
    await task.reload({ include: calendarIncludes(ctx.tenantModels, ctx.hasModule) });
    return NextResponse.json({ ok: true, data: toFCEvent(task), envio }, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
