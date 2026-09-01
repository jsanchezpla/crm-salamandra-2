// Serializa una CalendarTask al shape de evento de FullCalendar.
// Compartido por app/api/calendar/tasks/route.js y .../[id]/route.js.

import { colorDeCategoria } from "./categorias.js";

const PRIORITY_COLORS = {
  high: "#ef4444",
  medium: "#f97316",
  low: "#22c55e",
};

/*
 * DOS COLORES POR EVENTO (01/09/2026, Rodrigo). El calendario se puede mirar
 * por PRIORIDAD (qué corre más) o por CATEGORÍA (de qué va), y son dos
 * lecturas distintas de la misma semana: la primera para decidir por dónde
 * empezar, la segunda para ver en qué se va el tiempo.
 *
 * Los dos viajan SIEMPRE en el evento y el que manda lo elige la pantalla con
 * los botones de arriba. Se manda todo desde el servidor y no se recalcula al
 * cambiar de modo porque cambiar de modo no puede costar una petición: es un
 * botón, y el calendario ya tiene delante lo que necesita.
 *
 * `task.color` sigue mandando sobre la prioridad: es el color a mano de un
 * evento concreto, que alguien puso por algo.
 */
export function toFCEvent(task) {
  const colorPrioridad = task.color ?? PRIORITY_COLORS[task.priority] ?? PRIORITY_COLORS.medium;
  const colorCategoria = colorDeCategoria(task.category);
  const color = colorPrioridad;

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
      // Los dos colores del evento (ver la nota de arriba). `colorCategoria`
      // es null cuando el evento no tiene categoría: la pantalla lo pinta
      // entonces en gris, que es lo honesto —no es de ninguna— en vez de
      // colarlo en la categoría de al lado.
      colorPrioridad,
      colorCategoria,
      categoryId: task.categoryId ?? null,
      categoryName: task.category?.name ?? null,
      // FKs opcionales + nombres (los nombres solo si se incluyeron las
      // asociaciones client/teamMember al consultar).
      clientId: task.clientId ?? null,
      teamMemberId: task.teamMemberId ?? null,
      clientName: task.client?.name ?? null,
      teamMemberName: task.teamMember?.displayName ?? null,
      // La convocatoria (27/08/2026): el enlace de la videollamada, a quién se
      // le manda y si ya salió. `inviteSentAt` va porque la pantalla tiene que
      // poder decir «ya se envió» en vez de dejar dudando si se pulsó.
      meetUrl: task.meetUrl ?? null,
      inviteEmail: task.inviteEmail ?? null,
      inviteSentAt: task.inviteSentAt ?? null,
      // A quién afecta (29/08/2026). Solo ids: los nombres ya los tiene la
      // pantalla, que baja el equipo entero para sus desplegables.
      attendeeIds: (task.attendeeLinks ?? []).map((l) => l.teamMemberId),
      // Quién se encarga (01/09/2026), que ya no es uno solo. Se manda también
      // `teamMemberId` (el principal) porque hay pantallas que siguen leyendo
      // esa columna —ver models/tenant/CalendarTaskOwner.model.js—.
      ownerIds: (task.ownerLinks ?? []).map((l) => l.teamMemberId),
    },
  };
}

// Include reutilizable para traer los nombres de cliente y team member.
// Condicionado a hasModule: en tenants con schema parcial (provisionado por
// módulo, no por sync completo) la tabla clients/team_members puede NO existir;
// incluirla haría un JOIN a una relación inexistente → 500. Solo se incluye si
// el módulo está activo (⇒ la tabla existe).
export function calendarIncludes(tenantModels, hasModule) {
  const { Client, TeamMember, CalendarTaskAttendee, CalendarTaskOwner, CalendarCategory } = tenantModels;
  const inc = [];
  if (!hasModule || hasModule("clients")) {
    inc.push({ model: Client, as: "client", attributes: ["id", "name"] });
  }
  if (!hasModule || hasModule("team")) {
    inc.push({ model: TeamMember, as: "teamMember", attributes: ["id", "displayName"] });
    // A quién afecta (29/08/2026). Misma condición que el responsable: sin
    // módulo de equipo no hay a quién convocar (y la tabla puede no existir).
    inc.push({ model: CalendarTaskAttendee, as: "attendeeLinks", attributes: ["teamMemberId"] });
    // Los responsables (01/09/2026), por lo mismo.
    inc.push({ model: CalendarTaskOwner, as: "ownerLinks", attributes: ["teamMemberId"] });
  }
  // La categoría NO se gatea por módulo: su tabla la crea la migración CORE
  // en todo schema que tenga `calendar_tasks`, o sea, siempre que esta consulta
  // pueda correr. Y sin ella el evento no sabría de qué color pintarse.
  inc.push({ model: CalendarCategory, as: "category", attributes: ["id", "name", "color"], required: false });
  return inc;
}

// Normaliza un id opcional del body: string no vacío -> trim, resto -> null.
export function normId(v) {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Resuelve y VALIDA las FKs opcionales (clientId/teamMemberId) del body.
 * Solo procesa una clave si viene en el body. Si el módulo (clients/team) no
 * está activo, la ignora (queda null). Valida existencia con findByPk para
 * devolver un 400 limpio en vez de un 500 por violación de FK / uuid inválido.
 *
 * Devuelve { updates, error }: updates = { clientId?, teamMemberId? } solo con
 * las claves presentes; error = mensaje (400) o null.
 */
export async function resolveCalendarFks(body, tenantModels, hasModule) {
  const out = { updates: {}, error: null };
  const spec = [
    ["clientId", tenantModels.Client, "clients"],
    ["teamMemberId", tenantModels.TeamMember, "team"],
    // La categoría no depende de ningún módulo aparte del propio Calendario
    // (su tabla es CORE): se pasa `null` como moduleKey y `hasModule` no se
    // consulta —ver el `moduleKey == null` de abajo—.
    ["categoryId", tenantModels.CalendarCategory, null],
  ];
  for (const [key, model, moduleKey] of spec) {
    if (!(key in body)) continue;
    const id = normId(body[key]);
    if (id && (moduleKey == null || hasModule(moduleKey))) {
      const row = await model.findByPk(id, { attributes: ["id"] }).catch(() => null);
      if (!row) { out.error = `${key} no existe`; return out; }
      out.updates[key] = id;
    } else {
      out.updates[key] = null; // vacío o módulo inactivo → sin asignar
    }
  }
  return out;
}

/**
 * La lista «Afecta a» del body (29/08/2026), validada como las FKs de arriba:
 * un id que no existe responde 400 limpio, no un 500 de violación de FK.
 *
 * Devuelve { present, ids, error }:
 *   present=false → la clave no vino en el body: no se toca nada.
 *   ids           → lista deduplicada de TeamMember existentes ([] = nadie).
 * Sin módulo de equipo, present=false SIEMPRE — no solo porque no haya a quién
 * convocar: en ese tenant la tabla calendar_task_attendees puede NO existir
 * (la migración exige team_members), y tocarla sería un 42P01.
 */
export async function resolveAttendees(body, tenantModels, hasModule) {
  if (!("attendeeIds" in body) || !hasModule("team")) return { present: false, ids: null, error: null };
  if (!Array.isArray(body.attendeeIds)) return { present: true, ids: null, error: "attendeeIds tiene que ser una lista" };

  const ids = [...new Set(body.attendeeIds.map(normId).filter(Boolean))];
  if (!ids.length) return { present: true, ids: [], error: null };

  const filas = await tenantModels.TeamMember.findAll({ where: { id: ids }, attributes: ["id"] }).catch(() => null);
  if (!filas || filas.length !== ids.length) {
    return { present: true, ids: null, error: "Algún miembro del equipo de «Afecta a» no existe" };
  }
  return { present: true, ids, error: null };
}

/**
 * Deja las filas de calendar_task_attendees iguales a `ids`. Las copias de
 * Google de los que SALEN de la lista las quita ANTES quien llama (el CASCADE
 * se lleva la fila, y con ella el único sitio donde vive el googleEventId).
 * Devuelve las filas que se van a quitar, para eso mismo.
 */
export async function reconciliarAsistentes({ taskId, ids, tenantModels }) {
  const { CalendarTaskAttendee } = tenantModels;
  const actuales = await CalendarTaskAttendee.findAll({ where: { taskId } });
  const quedan = new Set(ids);
  const sobran = actuales.filter((l) => !quedan.has(l.teamMemberId));
  const yaEstan = new Set(actuales.map((l) => l.teamMemberId));
  const faltan = ids.filter((id) => !yaEstan.has(id));
  return {
    sobran,
    aplicar: async () => {
      if (sobran.length) await CalendarTaskAttendee.destroy({ where: { id: sobran.map((l) => l.id) } });
      if (faltan.length) await CalendarTaskAttendee.bulkCreate(faltan.map((teamMemberId) => ({ taskId, teamMemberId })));
    },
  };
}
/**
 * La lista de RESPONSABLES del body (01/09/2026), validada como «Afecta a».
 *
 * Devuelve `{ present, ids, error }` con el mismo contrato que
 * `resolveAttendees`: `present=false` → la clave no vino y no se toca nada
 * (el arrastre de un evento manda cuatro fechas y no puede vaciar la lista de
 * paso). Sin módulo de equipo, `present=false` SIEMPRE: ahí la tabla
 * `calendar_task_owners` puede no existir y tocarla sería un 42P01.
 */
export async function resolveOwners(body, tenantModels, hasModule) {
  if (!("ownerIds" in body) || !hasModule("team")) return { present: false, ids: null, error: null };
  if (!Array.isArray(body.ownerIds)) return { present: true, ids: null, error: "ownerIds tiene que ser una lista" };

  const ids = [...new Set(body.ownerIds.map(normId).filter(Boolean))];
  if (!ids.length) return { present: true, ids: [], error: null };

  const filas = await tenantModels.TeamMember.findAll({ where: { id: ids }, attributes: ["id"] }).catch(() => null);
  if (!filas || filas.length !== ids.length) {
    return { present: true, ids: null, error: "Algún responsable no existe en el equipo" };
  }
  return { present: true, ids, error: null };
}

/**
 * Deja `calendar_task_owners` igual a `ids` y devuelve QUIÉN ES EL PRINCIPAL
 * —el primero de la lista—, que es lo que se guarda en
 * `calendar_tasks.team_member_id` como espejo.
 *
 * Que el espejo se escriba aquí y no en cada endpoint es a propósito: son dos
 * escrituras que tienen que ir juntas siempre, y separarlas es la forma
 * segura de que un día una se quede sin la otra y la portada empiece a
 * enseñar el trabajo de quien ya no lo lleva.
 */
export async function reconciliarResponsables({ taskId, ids, tenantModels }) {
  const { CalendarTaskOwner } = tenantModels;
  const actuales = await CalendarTaskOwner.findAll({ where: { taskId } });
  const quedan = new Set(ids);
  const sobran = actuales.filter((l) => !quedan.has(l.teamMemberId));
  const yaEstan = new Set(actuales.map((l) => l.teamMemberId));
  const faltan = ids.filter((id) => !yaEstan.has(id));

  if (sobran.length) await CalendarTaskOwner.destroy({ where: { id: sobran.map((l) => l.id) } });
  if (faltan.length) await CalendarTaskOwner.bulkCreate(faltan.map((teamMemberId) => ({ taskId, teamMemberId })));

  return ids[0] ?? null;
}
