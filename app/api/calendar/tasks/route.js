import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden } from "../../../../lib/utils/apiResponse.js";
import { ForbiddenError, handleRouteError } from "../../../../lib/utils/errors.js";
import { getTenantContext } from "../../../../lib/tenant/tenantResolver.js";
import { Op } from "sequelize";
import { NextResponse } from "next/server";
import { toFCEvent, calendarIncludes, resolveCalendarFks } from "../../../../lib/calendar/calendarEvent.js";

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

  return ok(tasks.map(toFCEvent));
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
    });

    // Recarga con asociaciones para devolver los nombres al frontend.
    await task.reload({ include: calendarIncludes(ctx.tenantModels, ctx.hasModule) });
    return NextResponse.json({ ok: true, data: toFCEvent(task) }, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
