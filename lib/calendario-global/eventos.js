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
 * el del usuario que mira: la autorización ya la dio `calendarioDe`, y el
 * contexto del tenant es el que sabe qué módulos tiene y a qué Google copiar.
 *
 * ── 12/09/2026: TODOS LOS CLIENTES Y SUS PROYECTOS ──────────────────────────
 * La lista ya no sale solo de los vínculos sino de `acceso.js`
 * (`calendariosDe`: un admin de Salamandra ve todos los clientes). La pantalla
 * pide los clientes que tiene seleccionados (`slugs`) y, si quiere, las
 * tarjetas e hitos de Proyectos (`fetchProjectEvents`, lo mismo que mezcla el
 * calendario del tenant). Un cliente sin Calendario pero con Proyectos enseña
 * sus proyectos: Aumenta en producción es así. Cada evento lleva `kind`
 * (calendarTask / projectTask / projectMilestone) para que la pantalla sepa a
 * qué endpoint mandar el arrastre. Ver
 * docs/decisions/2026-09-12-el-calendario-global-ve-todos-y-los-proyectos.md.
 */

import { Op } from "sequelize";
import { getTenantContextPorSlug } from "../tenant/tenantResolver.js";
import { toFCEvent, calendarIncludes } from "../calendar/calendarEvent.js";
import { fetchProjectEvents } from "../calendar/projectEvents.js";
import { sincronizarTareaConGoogle } from "../calendar/googleSync.js";
import { auditar, resumen } from "../utils/auditoria.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../utils/errorTypes.js";
import { calendariosDe, calendarioDe, fichaPublica } from "./acceso.js";
import { fechaValida } from "./fechas.js";

const VALID_STATUS = ["pending", "done", "cancelled"];
const HORA = /^\d{2}:\d{2}(:\d{2})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lo que viaja de cada cliente dentro de cada evento. */
function calendarioDelEvento(entrada) {
  return { slug: entrada.slug, nombre: entrada.nombre, color: entrada.color };
}

/**
 * El evento de FullCalendar de un CalendarTask de un tenant, marcado con su
 * calendario. El id lleva el slug delante porque dos tenants pueden tener el
 * mismo UUID de tarea… no, no pueden, pero FullCalendar exige ids únicos y con
 * el slug delante nadie tiene que fiarse de eso. `taskId` guarda el de verdad.
 */
export function etiquetar(ev, entrada) {
  return {
    ...ev,
    id: `${entrada.slug}:${ev.id}`,
    // El color del CALENDARIO manda en el global: la pregunta aquí es «de
    // quién es esto», no «cuánto corre». La pantalla puede cambiar a
    // prioridad con `colorPrioridad`, que sigue viajando dentro.
    backgroundColor: entrada.color,
    borderColor: entrada.color,
    extendedProps: {
      ...ev.extendedProps,
      kind: "calendarTask",
      taskId: ev.id,
      calendario: calendarioDelEvento(entrada),
    },
  };
}

/**
 * Lo mismo para una tarjeta o un hito de Proyectos (`fetchProjectEvents`).
 *
 * Distinto de `etiquetar` en tres cosas, y las tres rompían algo:
 *   · NO pisa `taskId`: el evento ya trae el UUID real de la tarjeta, y su `id`
 *     es `project-task:<uuid>`. Con `etiquetar` el arrastre mandaba ese texto a
 *     Postgres como UUID (500).
 *   · `durationEditable: false`: una tarjeta tiene fecha límite, no duración;
 *     estirarla no significa nada.
 *   · guarda el color de su columna o de su estado en `colorOriginal`, para
 *     que la pantalla lo recupere en «Color por prioridad» (los hitos no
 *     tienen prioridad). `editable` del hito (solo los pendientes) se conserva.
 */
export function etiquetarProyecto(ev, entrada) {
  return {
    ...ev,
    id: `${entrada.slug}:${ev.id}`,
    backgroundColor: entrada.color,
    borderColor: entrada.color,
    durationEditable: false,
    extendedProps: {
      ...ev.extendedProps,
      colorOriginal: ev.backgroundColor ?? null,
      calendario: calendarioDelEvento(entrada),
    },
  };
}

/**
 * Los eventos de los clientes elegidos entre dos fechas.
 *
 * @param {object} p
 * @param {string} p.usuarioId
 * @param {string} [p.start] @param {string} [p.end]
 * @param {string[]|null} [p.slugs] null = todos los autorizados; los que no lo
 *   estén se ignoran en silencio
 * @param {boolean} [p.proyectos=true] mezclar tarjetas e hitos de Proyectos
 * @returns {Promise<{ calendarios: object[], eventos: object[] }>} `calendarios`
 *   trae TODOS los autorizados (la barra lateral los lista aunque estén
 *   ocultos); `fallo` solo dice algo de los elegidos.
 *
 * Un tenant cuya base falle NO tumba a los demás: su ficha sale con
 * `fallo: true` y la pantalla lo dice.
 *
 * `start` y `end`, si llegan, tienen que ser fechas civiles de verdad
 * (12/09/2026, hallazgo 7): `2026-13-01` hacía fallar la consulta en TODOS los
 * clientes y la pantalla los pintaba todos como «no responde». El route ya las
 * valida y devuelve 400; esto es la misma puerta por si otro las llama.
 */
export async function leerEventos({ usuarioId, start, end, slugs = null, proyectos = true }) {
  if (start && !fechaValida(start)) throw new ValidationError("Fecha de inicio inválida");
  if (end && !fechaValida(end)) throw new ValidationError("Fecha de fin inválida");
  const { calendarios: entradas } = await calendariosDe(usuarioId);
  const elegidos = Array.isArray(slugs) ? new Set(slugs) : null;
  const where = {};
  if (start && end) where.startDate = { [Op.between]: [start, end] };
  else if (start) where.startDate = { [Op.gte]: start };

  const calendarios = entradas.map((e) => ({ ...fichaPublica(e), fallo: false }));
  // Un hueco por cliente, en el orden de la lista: los eventos salen siempre
  // en el mismo orden aunque las consultas terminen cuando quieran.
  const porCliente = entradas.map(() => []);

  await Promise.all(
    entradas.map(async (entrada, i) => {
      if (elegidos && !elegidos.has(entrada.slug)) return;
      const conCalendario = entrada.calendario;
      const conProyectos = proyectos && entrada.proyectos;
      if (!conCalendario && !conProyectos) return;
      try {
        const ctx = await getTenantContextPorSlug(entrada.slug);
        const suyos = [];
        if (conCalendario) {
          const { CalendarTask } = ctx.tenantModels;
          const tasks = await CalendarTask.findAll({
            where,
            include: calendarIncludes(ctx.tenantModels, ctx.hasModule),
            order: [["startDate", "ASC"], ["startTime", "ASC"]],
          });
          for (const t of tasks) suyos.push(etiquetar(toFCEvent(t), entrada));
        }
        if (conProyectos) {
          // Con `lanzar: true` (12/09/2026, hallazgo 5 de la revisión). Antes
          // se usaba la variante que se traga el error y devuelve []: un cliente
          // cuya base de Proyectos no respondía (o le faltaba una tabla) salía
          // como «nada esta semana», sin aviso, mientras la pestaña Proyectos
          // del mismo cliente sí decía «no responde». Y
          // `getTenantContextPorSlug` no toca su base, así que el catch de
          // fuera no lo veía nunca. Aquí tiene su propio try: marca `fallo`
          // pero NO tira los eventos del Calendario ya leídos, que sí valen.
          try {
            const deProyectos = await fetchProjectEvents({
              tenantModels: ctx.tenantModels,
              hasModule: ctx.hasModule,
              start,
              end,
              lanzar: true,
            });
            for (const ev of deProyectos) suyos.push(etiquetarProyecto(ev, entrada));
          } catch (err) {
            console.error(`[calendario-global] no se pudieron leer los proyectos de ${entrada.slug}:`, err?.message ?? err);
            calendarios[i].fallo = true;
          }
        }
        porCliente[i] = suyos;
      } catch (err) {
        console.error(`[calendario-global] no se pudo leer ${entrada.slug}:`, err?.message ?? err);
        calendarios[i].fallo = true;
      }
    })
  );
  return { calendarios, eventos: porCliente.flat() };
}

/**
 * Mueve un evento (o le cambia el estado) desde el global.
 *
 * `cambios` admite SOLO: startDate, startTime, endDate, endTime, allDay,
 * status. Cualquier otro campo se ignora: lo de dentro se edita en el tenant.
 */
export async function moverEvento({ usuarioId, slug, taskId, cambios, ip = null }) {
  if (typeof taskId !== "string" || !UUID.test(taskId)) throw new ValidationError("Evento inválido");
  // `"startDate" in 5` lanza TypeError (un 500): el route ya lo frena con 400,
  // y aquí se frena otra vez antes de leer nada (12/09/2026, hallazgo 3).
  if (!cambios || typeof cambios !== "object" || Array.isArray(cambios)) throw new ValidationError("Body inválido");
  const entrada = await calendarioDe(usuarioId, slug);
  if (!entrada) throw new ForbiddenError("No tienes acceso a ese calendario");
  if (!entrada.calendario) throw new ForbiddenError("Ese cliente no tiene el módulo Calendario activo");

  const ctx = await getTenantContextPorSlug(slug);
  const { CalendarTask } = ctx.tenantModels;
  const task = await CalendarTask.findByPk(taskId);
  if (!task) throw new NotFoundError("Evento no encontrado");

  const updates = {};
  // Fechas con `fechaValida` y no con la regex (12/09/2026, hallazgo 7): con
  // `2026-02-31` el DATEONLY de Sequelize lo dejaba en «Invalid date» y
  // Postgres lo rechazaba en el UPDATE, un 500 en vez de un 400.
  if ("startDate" in cambios) {
    if (!fechaValida(cambios.startDate)) throw new ValidationError("Fecha de inicio inválida");
    updates.startDate = cambios.startDate;
  }
  if ("endDate" in cambios) {
    if (cambios.endDate != null && !fechaValida(cambios.endDate)) throw new ValidationError("Fecha de fin inválida");
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
  return etiquetar(toFCEvent(task), entrada);
}
