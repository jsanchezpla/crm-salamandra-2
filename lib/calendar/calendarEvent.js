// Serializa una CalendarTask al shape de evento de FullCalendar.
// Compartido por app/api/calendar/tasks/route.js y .../[id]/route.js.

const PRIORITY_COLORS = {
  high: "#ef4444",
  medium: "#f97316",
  low: "#22c55e",
};

export function toFCEvent(task) {
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
    },
  };
}

// Include reutilizable para traer los nombres de cliente y team member.
// Condicionado a hasModule: en tenants con schema parcial (provisionado por
// módulo, no por sync completo) la tabla clients/team_members puede NO existir;
// incluirla haría un JOIN a una relación inexistente → 500. Solo se incluye si
// el módulo está activo (⇒ la tabla existe).
export function calendarIncludes(tenantModels, hasModule) {
  const { Client, TeamMember } = tenantModels;
  const inc = [];
  if (!hasModule || hasModule("clients")) {
    inc.push({ model: Client, as: "client", attributes: ["id", "name"] });
  }
  if (!hasModule || hasModule("team")) {
    inc.push({ model: TeamMember, as: "teamMember", attributes: ["id", "displayName"] });
  }
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
  ];
  for (const [key, model, moduleKey] of spec) {
    if (!(key in body)) continue;
    const id = normId(body[key]);
    if (id && hasModule(moduleKey)) {
      const row = await model.findByPk(id, { attributes: ["id"] }).catch(() => null);
      if (!row) { out.error = `${key} no existe`; return out; }
      out.updates[key] = id;
    } else {
      out.updates[key] = null; // vacío o módulo inactivo → sin asignar
    }
  }
  return out;
}
