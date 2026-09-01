import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, noContent, forbidden } from "../../../../../lib/utils/apiResponse.js";
import { NotFoundError } from "../../../../../lib/utils/errors.js";
import {
  toFCEvent,
  calendarIncludes,
  resolveCalendarFks,
  resolveAttendees,
  reconciliarAsistentes,
  resolveOwners,
  reconciliarResponsables,
} from "../../../../../lib/calendar/calendarEvent.js";
import { sincronizarTareaConGoogle, quitarCopiasDeGoogle } from "../../../../../lib/calendar/googleSync.js";
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

export const PUT = withTenant(async (request, { params }, ctx) => {
  const { tenant, tenantModels, hasModule } = ctx;
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

  // «Afecta a» (29/08/2026): validada ANTES de escribir, como todo lo demás.
  // Solo se toca si viene en el body — el arrastre manda cuatro fechas y nada
  // más, y no puede vaciar la lista de convocados de paso.
  const asistentes = await resolveAttendees(body, tenantModels, hasModule);
  if (asistentes.error) return errorResponse(asistentes.error);

  // Los responsables (01/09/2026), con la misma regla: solo se tocan si vienen.
  const responsables = await resolveOwners(body, tenantModels, hasModule);
  if (responsables.error) return errorResponse(responsables.error);

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
   * Los responsables, y con ellos el espejo `team_member_id`. Va DESPUÉS del
   * update para que el espejo escrito aquí gane: el bucle de `allowed` no
   * incluye `teamMemberId` —lo trae `resolveCalendarFks`—, y si llegaran los
   * dos en el mismo cuerpo mandaría la lista, que es la que ve el usuario.
   */
  if (responsables.present) {
    const principal = await reconciliarResponsables({
      taskId: task.id,
      ids: responsables.ids,
      tenantModels,
    });
    if (principal !== task.teamMemberId) await task.update({ teamMemberId: principal });
  }

  // La lista de convocados, y el espejo en Google. A quien SALE de la lista se
  // le quita su copia ANTES de borrar la fila (el CASCADE se llevaría el id);
  // después se sincroniza a los que quedan — que cubre también el arrastre de
  // fechas, donde la lista no viene pero las copias tienen que moverse.
  if (asistentes.present) {
    const rec = await reconciliarAsistentes({ taskId: task.id, ids: asistentes.ids, tenantModels });
    await quitarCopiasDeGoogle({ links: rec.sobran, ctx });
    await rec.aplicar();
  }
  await sincronizarTareaConGoogle({ task, ctx });

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

export const DELETE = withTenant(async (request, { params }, ctx) => {
  const { tenant, tenantModels, hasModule } = ctx;
  if (!hasModule("calendar")) return forbidden();

  const { id } = await params;
  const task = await resolveTask(tenantModels, id);
  const antesBorrar = resumen(task, ["title", "startDate", "status"]);
  const idBorrado = task.id;
  // Las copias de Google se quitan ANTES del destroy: el CASCADE borra las
  // filas de asistentes, y con ellas el único sitio donde vive cada googleEventId.
  const links = await tenantModels.CalendarTaskAttendee.findAll({ where: { taskId: task.id } }).catch(() => []);
  await quitarCopiasDeGoogle({ links, ctx });
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
