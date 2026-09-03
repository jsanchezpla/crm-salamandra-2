/**
 * lib/calendario-global/eventos.js — los eventos de varios tenants en una sola
 * lista, y el arrastre desde el global (03/09/2026, Rodrigo).
 *
 * ── QUÉ SE PUEDE HACER DESDE EL GLOBAL Y QUÉ NO ─────────────────────────────
 * Desde el global se VE y se MUEVE: fechas, horas, todo-el-día y el estado
 * (hecha / pendiente). Lo de dentro del evento —título, notas, responsables,
 * cliente, categoría, convocatoria— se edita en el tenant, saltando con
 * `salto.js`. Es la regla que pidió Rodrigo: «cambiar la hora o lo de dentro
 * de esa tarea, ahí que me lleve al tenant concreto». Aquí solo el arrastre y
 * el tick; el resto de campos ni se aceptan.
 *
 * ── MISMO CAMINO QUE EL TENANT ──────────────────────────────────────────────
 * Mover un evento aquí pasa por lo mismo que moverlo en /calendario del
 * tenant: `task.update` + el espejo en Google de sus asistentes + auditoría.
 * Se escribe con el contexto del TENANT (`getTenantContextPorSlug`), no con
 * el del usuario que mira: la autorización ya la dio el vínculo, y el
 * contexto del tenant es el que sabe qué módulos tiene y a qué Google copiar.
 */

import { Op } from "sequelize";
import { getTenantContextPorSlug } from "../tenant/tenantResolver.js";
import { toFCEvent, calendarIncludes } from "../calendar/calendarEvent.js";
import { sincronizarTareaConGoogle } from "../calendar/googleSync.js";
import { auditar, resumen } from "../utils/auditoria.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../utils/errorTypes.js";
import { vinculosDe, vinculoDe } from "./vinculos.js";

const VALID_STATUS = ["pending", "done", "cancelled"];
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^\d{2}:\d{2}(:\d{2})?$/;

/**
 * El evento de FullCalendar de un tenant, marcado con su calendario. El id
 * lleva el slug delante porque dos tenants pueden tener el mismo UUID de
 * tarea… no, no pueden, pero FullCalendar exige ids únicos y con el slug
 * delante nadie tiene que fiarse de eso. `taskId` guarda el de verdad.
 */
export function etiquetar(ev, vinculo) {
  return {
    ...ev,
    id: `${vinculo.slug}:${ev.id}`,
    // El color del CALENDARIO manda en el global: la pregunta aquí es «de
    // quién es esto», no «cuánto corre». La pantalla puede cambiar a
    // prioridad con `colorPrioridad`, que sigue viajando dentro.
    backgroundColor: vinculo.color,
    borderColor: vinculo.color,
    extendedProps: {
      ...ev.extendedProps,
      taskId: ev.id,
      calendario: { slug: vinculo.slug, nombre: vinculo.nombre, color: vinculo.color },
    },
  };
}

/**
 * Los eventos de todos los calendarios vinculados entre dos fechas.
 *
 * Un tenant cuya base falle NO tumba a los demás: se devuelve su calendario
 * con `fallo: true` y la pantalla lo dice. Los tenants sin el módulo
 * `calendar` se listan apagados y no se consultan.
 */
export async function leerEventos({ usuarioId, start, end }) {
  const vinculos = await vinculosDe(usuarioId);
  const where = {};
  if (start && end) where.startDate = { [Op.between]: [start, end] };
  else if (start) where.startDate = { [Op.gte]: start };

  const calendarios = [];
  const eventos = [];
  await Promise.all(
    vinculos.map(async (v) => {
      const ficha = { slug: v.slug, nombre: v.nombre, color: v.color, calendario: v.calendario, puedeSaltar: !!v.tenantUsuarioId, fallo: false };
      calendarios.push(ficha);
      if (!v.calendario) return;
      try {
        const ctx = await getTenantContextPorSlug(v.slug);
        const { CalendarTask } = ctx.tenantModels;
        const tasks = await CalendarTask.findAll({
          where,
          include: calendarIncludes(ctx.tenantModels, ctx.hasModule),
          order: [["startDate", "ASC"], ["startTime", "ASC"]],
        });
        for (const t of tasks) eventos.push(etiquetar(toFCEvent(t), v));
      } catch (err) {
        console.error(`[calendario-global] no se pudo leer ${v.slug}:`, err?.message ?? err);
        ficha.fallo = true;
      }
    })
  );
  calendarios.sort((a, b) => vinculos.findIndex((v) => v.slug === a.slug) - vinculos.findIndex((v) => v.slug === b.slug));
  return { calendarios, eventos };
}

/**
 * Mueve un evento (o le cambia el estado) desde el global.
 *
 * `cambios` admite SOLO: startDate, startTime, endDate, endTime, allDay,
 * status. Cualquier otro campo se ignora: lo de dentro se edita en el tenant.
 */
export async function moverEvento({ usuarioId, slug, taskId, cambios, ip = null }) {
  const vinculo = await vinculoDe(usuarioId, slug);
  if (!vinculo) throw new ForbiddenError("Ese calendario no está vinculado a tu cuenta");
  if (!vinculo.calendario) throw new ForbiddenError("Ese cliente no tiene el módulo Calendario activo");

  const ctx = await getTenantContextPorSlug(slug);
  const { CalendarTask } = ctx.tenantModels;
  const task = await CalendarTask.findByPk(taskId);
  if (!task) throw new NotFoundError("Evento no encontrado");

  const updates = {};
  if ("startDate" in cambios) {
    if (!FECHA.test(String(cambios.startDate ?? ""))) throw new ValidationError("Fecha de inicio inválida");
    updates.startDate = cambios.startDate;
  }
  if ("endDate" in cambios) {
    if (cambios.endDate != null && !FECHA.test(String(cambios.endDate))) throw new ValidationError("Fecha de fin inválida");
    updates.endDate = cambios.endDate || null;
  }
  if ("startTime" in cambios) {
    if (cambios.startTime != null && !HORA.test(String(cambios.startTime))) throw new ValidationError("Hora de inicio inválida");
    updates.startTime = cambios.startTime || null;
  }
  if ("endTime" in cambios) {
    if (cambios.endTime != null && !HORA.test(String(cambios.endTime))) throw new ValidationError("Hora de fin inválida");
    updates.endTime = cambios.endTime || null;
  }
  if ("allDay" in cambios) updates.allDay = Boolean(cambios.allDay);
  if ("status" in cambios) {
    if (!VALID_STATUS.includes(cambios.status)) throw new ValidationError("Estado inválido");
    updates.status = cambios.status;
  }
  if (!Object.keys(updates).length) throw new ValidationError("Nada que cambiar");

  // Todo-el-día no lleva horas, igual que en el tenant.
  const allDay = "allDay" in updates ? updates.allDay : task.allDay;
  if (allDay) {
    updates.startTime = null;
    updates.endTime = null;
  }

  const antes = resumen(task, ["title", "startDate", "startTime", "status"]);
  await task.update(updates);
  // El espejo en el Google de cada asistente. Nunca lanza (googleSync.js).
  await sincronizarTareaConGoogle({ task, ctx });
  await auditar({
    tenantId: ctx.tenant.id,
    userId: usuarioId,
    ip,
    action: "calendar.task.updated",
    entity: "CalendarTask",
    entityId: task.id,
    before: antes,
    after: { ...resumen(task, ["title", "startDate", "startTime", "status"]), desde: "calendario_global" },
  });

  await task.reload({ include: calendarIncludes(ctx.tenantModels, ctx.hasModule) });
  return etiquetar(toFCEvent(task), vinculo);
}
