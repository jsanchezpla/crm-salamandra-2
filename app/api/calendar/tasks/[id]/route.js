import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, noContent, forbidden } from "../../../../../lib/utils/apiResponse.js";
import { NotFoundError, ForbiddenError } from "../../../../../lib/utils/errors.js";

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

async function resolveTask(tenantModels, id) {
  const { CalendarTask } = tenantModels;
  const task = await CalendarTask.findByPk(id);
  if (!task) throw new NotFoundError("Tarea no encontrada");
  return task;
}

export const PUT = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("calendar")) return forbidden();

  const { id } = await params;
  const task = await resolveTask(tenantModels, id);
  const body = await request.json();

  const VALID_PRIORITY = ["high", "medium", "low"];
  const VALID_STATUS = ["pending", "done", "cancelled"];

  const allowed = ["title", "notes", "priority", "status", "startDate", "startTime", "endDate", "endTime", "allDay", "color"];
  const updates = {};

  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  if (updates.title !== undefined) updates.title = updates.title?.trim() || task.title;
  if (updates.priority && !VALID_PRIORITY.includes(updates.priority)) delete updates.priority;
  if (updates.status && !VALID_STATUS.includes(updates.status)) delete updates.status;

  // Si allDay se activa, limpiar horas
  const allDay = "allDay" in updates ? Boolean(updates.allDay) : task.allDay;
  if (allDay) {
    updates.startTime = null;
    updates.endTime = null;
  }

  await task.update(updates);
  return ok(toFCEvent(task));
});

export const DELETE = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("calendar")) return forbidden();

  const { id } = await params;
  const task = await resolveTask(tenantModels, id);
  await task.destroy();
  return noContent();
});
