/**
 * lib/clinica/grupoDeTaller.js — cómo se lee y cómo se guarda un grupo de
 * taller (01/09/2026, Aumenta por Rodrigo).
 *
 * (Fichero nuevo en /lib, regla #2: el alta, la edición, la ficha y la agenda
 * necesitan el MISMO grupo con la misma forma. La lista de terapeutas es lo que
 * de verdad obliga: guardarla es un reemplazo con un coordinador único, y
 * escrito dos veces acabaría habiendo grupos con dos coordinadores o con
 * ninguno, que es lo que decide quién es el dueño de la cita.)
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids limpios, sin repetidos y sin basura. */
export function limpiarIds(lista) {
  if (!Array.isArray(lista)) return [];
  const out = [];
  for (const v of lista) {
    const id = typeof v === "string" ? v.trim() : "";
    if (UUID_RE.test(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * El grupo tal como lo lee la pantalla: sus datos, quién lo imparte (con quién
 * coordina marcado) y cuánta gente hay apuntada ahora.
 */
export function serializarGrupo(grupo, { apuntados = 0, tipoCita = null } = {}) {
  const j = grupo?.toJSON ? grupo.toJSON() : grupo ?? {};
  const terapeutas = (j.terapeutas ?? []).map((t) => ({
    id: t.id,
    teamMemberId: t.teamMemberId,
    coordina: !!t.coordina,
    displayName: t.profesional?.displayName ?? null,
    avatarColor: t.profesional?.avatarColor ?? null,
  }));
  return {
    id: j.id,
    tallerId: j.tallerId,
    name: j.name,
    schedule: j.schedule ?? null,
    duration: j.duration ?? 90,
    color: j.color ?? null,
    capacity: j.capacity ?? null,
    conceptId: j.conceptId ?? null,
    active: j.active !== false,
    notes: j.notes ?? null,
    terapeutas,
    // Quien coordina, suelto: es de quien sale el color de la caja y quién
    // figura como dueño de la cita.
    coordinaId: terapeutas.find((t) => t.coordina)?.teamMemberId ?? null,
    apuntados,
    tipoCita: tipoCita
      ? { id: tipoCita.id, name: tipoCita.name, active: tipoCita.active !== false }
      : null,
  };
}

/**
 * Reemplaza la lista de quien imparte un grupo.
 *
 * Es un REEMPLAZO y no un añadido: la pantalla manda la lista entera, que es
 * como se quita a alguien. Y garantiza el coordinador:
 *
 *   · si el que se pide coordinar no está en la lista, coordina el primero;
 *   · si la lista queda vacía, el grupo se queda sin nadie —es legítimo: un
 *     grupo se puede preparar antes de decidir quién lo da— y entonces la cita
 *     nacerá sin profesional asignado, como cualquier otra cita sin asignar.
 *
 * El «uno solo coordina» lo garantiza además un índice único parcial en la
 * base; esto es lo que evita que se llegue a intentar.
 */
export async function guardarTerapeutas({ tenantModels, grupo, ids, coordinaId }) {
  const { TallerGrupoTerapeuta } = tenantModels;
  if (!TallerGrupoTerapeuta || !grupo?.id) return [];

  const limpios = limpiarIds(ids);
  const coordina = limpios.includes(coordinaId) ? coordinaId : limpios[0] ?? null;

  // Fuera primero, dentro después: cambiar quién coordina sin borrar antes
  // chocaría con el índice único parcial.
  await TallerGrupoTerapeuta.destroy({ where: { grupoId: grupo.id } });
  if (!limpios.length) return [];

  return TallerGrupoTerapeuta.bulkCreate(
    limpios.map((teamMemberId) => ({
      grupoId: grupo.id,
      teamMemberId,
      coordina: teamMemberId === coordina,
    }))
  );
}

/**
 * Los ids de quien imparte un grupo, con el coordinador el primero.
 *
 * Ese orden no es cosmético: al apuntar la cita, el primero es quien queda como
 * dueño (`bookings.team_member_id`) y de quien sale el color de la caja.
 */
export async function terapeutasDeGrupo({ tenantModels, grupoId }) {
  const { TallerGrupoTerapeuta } = tenantModels;
  if (!TallerGrupoTerapeuta || !grupoId) return [];
  const filas = await TallerGrupoTerapeuta.findAll({
    where: { grupoId },
    order: [["coordina", "DESC"]],
    attributes: ["teamMemberId", "coordina"],
    raw: true,
  });
  return filas.map((f) => f.teamMemberId);
}
