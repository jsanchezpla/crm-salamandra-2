import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, noContent, forbidden } from "../../../../../lib/utils/apiResponse.js";
import { NotFoundError } from "../../../../../lib/utils/errors.js";
import { toFCEvent, calendarIncludes, resolveCalendarFks } from "../../../../../lib/calendar/calendarEvent.js";
import { error as errorResponse } from "../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion, resumen } from "../../../../../lib/utils/auditoria.js";
import {
  revisarEnlace,
  revisarCorreoInvitado,
  limpio,
  toca,
  enviarInvitacion,
} from "../../../../../lib/calendar/invitacion.js";

async function resolveTask(tenantModels, id) {
  const { CalendarTask } = tenantModels;
  const task = await CalendarTask.findByPk(id);
  if (!task) throw new NotFoundError("Tarea no encontrada");
  return task;
}

export const PUT = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
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

  // FKs opcionales validadas (400 si el id no existe; null explícito desasigna).
  const fk = await resolveCalendarFks(body, tenantModels, hasModule);
  if (fk.error) return errorResponse(fk.error);
  Object.assign(updates, fk.updates);

  if (updates.title !== undefined) updates.title = updates.title?.trim() || task.title;
  if (updates.priority && !VALID_PRIORITY.includes(updates.priority)) delete updates.priority;
  if (updates.status && !VALID_STATUS.includes(updates.status)) delete updates.status;

  // Si allDay se activa, limpiar horas
  const allDay = "allDay" in updates ? Boolean(updates.allDay) : task.allDay;
  if (allDay) {
    updates.startTime = null;
    updates.endTime = null;
  }

  /*
   * La convocatoria. Va aparte del bucle de `allowed` porque las dos se
   * VALIDAN antes de escribir: un enlace mal pegado tiene que responder 422 sin
   * haber tocado el evento, no dejarlo guardado con una dirección rota.
   *
   * Se tocan solo si vienen en el cuerpo: el arrastre de un evento en el
   * calendario manda cuatro campos de fecha y nada más, y no puede borrarle la
   * sala de paso.
   */
  if ("meetUrl" in body) {
    const v = limpio(body.meetUrl);
    const mal = revisarEnlace(v);
    if (mal) return errorResponse(mal, 422);
    updates.meetUrl = v;
  }
  if ("inviteEmail" in body) {
    const v = limpio(body.inviteEmail);
    const mal = revisarCorreoInvitado(v);
    if (mal) return errorResponse(mal, 422);
    updates.inviteEmail = v;
  }

  await task.update(updates);

  /*
   * Reenviar es un acto explícito: la casilla «mandarle el enlace» de la
   * pantalla. Aquí no hay disparo automático al detectar que apareció el
   * enlace, al revés que en Citas — un evento del calendario se arrastra y se
   * reajusta muchas veces, y un correo por cada roce sería ruido para quien no
   * lo ha pedido (el porqué entero, en `lib/calendar/invitacion.js`).
   */
  let envio = null;
  if (toca(body, task)) {
    envio = await enviarInvitacion({
      evento: task,
      tenant,
      quienConvoca: request.headers.get("x-user-email") || null,
    });
    if (envio.enviado) await task.update({ inviteSentAt: new Date() });
  }
  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "calendar.task.updated",
    entity: "CalendarTask",
    entityId: task.id,
    after: resumen(task, ["title", "startDate", "status"]),
  });
  await task.reload({ include: calendarIncludes(tenantModels, hasModule) });
  return ok({ ...toFCEvent(task), envio });
});

export const DELETE = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  if (!hasModule("calendar")) return forbidden();

  const { id } = await params;
  const task = await resolveTask(tenantModels, id);
  const antesBorrar = resumen(task, ["title", "startDate", "status"]);
  const idBorrado = task.id;
  await task.destroy();
  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "calendar.task.deleted",
    entity: "CalendarTask",
    entityId: idBorrado,
    before: antesBorrar,
  });
  return noContent();
});
