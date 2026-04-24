import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, forbidden } from "../../../../lib/utils/apiResponse.js";
import { ForbiddenError, handleRouteError } from "../../../../lib/utils/errors.js";
import { getTenantContext } from "../../../../lib/tenant/tenantResolver.js";
import { Op } from "sequelize";
import { NextResponse } from "next/server";

const PRIORITY_COLORS = {
  high: "#ef4444",
  medium: "#f97316",
  low: "#22c55e",
};

function toFCEvent(task) {
  const color = task.color ?? PRIORITY_COLORS[task.priority] ?? PRIORITY_COLORS.medium;

  let start, end;
  if (task.allDay) {
    start = task.startDate;
    end = task.endDate ?? undefined;
  } else {
    start = task.startTime ? `${task.startDate}T${task.startTime}` : task.startDate;
    end = task.endDate
      ? task.endTime
        ? `${task.endDate}T${task.endTime}`
        : task.endDate
      : undefined;
  }

  return {
    id: task.id,
    title: task.title,
    start,
    end,
    allDay: task.allDay,
    backgroundColor: color,
    borderColor: color,
    extendedProps: {
      notes: task.notes,
      priority: task.priority,
      status: task.status,
    },
  };
}

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

  const tasks = await CalendarTask.findAll({
    where,
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
    });

    return NextResponse.json({ ok: true, data: toFCEvent(task) }, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
