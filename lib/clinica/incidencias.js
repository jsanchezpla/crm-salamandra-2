/**
 * Incidencias — taxonomía, etiquetas y serializer (módulo Clínica).
 *
 * Categorías fijas del "Programa de Excelencia" de Aumenta + subcategorías
 * (sobre todo en Administrativa). La subcategoría se guarda como texto libre pero
 * la UI sugiere estas.
 *
 * ── Revisión de la taxonomía (29/08/2026, Aumenta por Rodrigo) ───────────────
 * Diez categorías en el orden en que las escribió el centro. Las CLAVES de las
 * ocho que ya existían no se tocan —están escritas en `incidencias.category` y
 * renombrar una clave dejaría filas apuntando a nada—, así que el cambio es de
 * etiqueta salvo en las dos que son nuevas de verdad:
 *
 *   · `comunicativa`  «Comunicativa»  → «Comunicación oficial»
 *   · `informacion`   «Información»   → «Solicitud de información»
 *   · `coordinacion`  «Coordinación»  → «Coordinación / apoyo»
 *   · `tecnologica`   se queda igual, con la M de «Material» en mayúscula fuera
 *   · `solicitud_laboral` y `otros` son NUEVAS.
 *
 * Las dos primeras estrechan el significado (una comunicación informal ya no
 * cabe en «Comunicación oficial»). Se pudo hacer sin reetiquetar nada porque el
 * 29/08/2026 la tabla `incidencias` estaba VACÍA en los ocho tenants con
 * clínica, comprobado en producción: no hay ni una fila que herede la etiqueta
 * nueva. Si algún día se reetiqueta un histórico, es un backfill aparte.
 */

/** La única categoría que obliga a decir cuál: «Otros» sin texto no informa de nada. */
export const CATEGORIA_LIBRE = "otros";
export const exigeSubcategoria = (key) => key === CATEGORIA_LIBRE;

import { resumenFalta } from "./faltas.js";

export const INCIDENCIA_CATEGORIES = [
  { key: "terapeutica", label: "Terapéutica", subcategories: [] },
  { key: "organizativa", label: "Organizativa", subcategories: [] },
  { key: "documental", label: "Documental", subcategories: [] },
  {
    key: "administrativa",
    label: "Administrativa",
    subcategories: ["Diagnóstico", "Impagados", "Facturación", "Altas y bajas", "Citas", "Otros"],
  },
  { key: "coordinacion", label: "Coordinación / apoyo", subcategories: [] },
  { key: "tecnologica", label: "Tecnológica / material", subcategories: [] },
  { key: "comunicativa", label: "Comunicación oficial", subcategories: [] },
  { key: "solicitud_laboral", label: "Solicitud laboral", subcategories: [] },
  { key: "informacion", label: "Solicitud de información", subcategories: [] },
  { key: CATEGORIA_LIBRE, label: "Otros", subcategories: [] },
];

export const INCIDENCIA_STATUS = {
  pending: { key: "pending", label: "Pendiente", level: "amber" },
  in_progress: { key: "in_progress", label: "En proceso", level: "blue" },
  resolved: { key: "resolved", label: "Resuelta", level: "green" },
};
export const INCIDENCIA_STATUS_ORDER = ["pending", "in_progress", "resolved"];

/**
 * VERIFICACIÓN del resultado (Aumenta, 04/08/2026). Registrar la acción es la
 * mitad del trabajo; la otra mitad es decir si funcionó, y «a medias» es el
 * resultado más común de una incidencia organizativa.
 *
 * ⚠️ La verificación GOBIERNA el estado: se enseña un solo control y el estado
 * se mueve solo. Dos controles que dicen cosas parecidas es la forma más rápida
 * de que una incidencia quede marcada como resuelta y pendiente a la vez.
 */
export const INCIDENCIA_VERIFICATIONS = [
  { key: "resuelta", label: "Resuelta", status: "resolved", level: "green" },
  { key: "parcial", label: "Parcial", status: "in_progress", level: "amber" },
  { key: "no_resuelta", label: "No resuelta", status: "in_progress", level: "red" },
];

const VERIFICATION = Object.fromEntries(INCIDENCIA_VERIFICATIONS.map((v) => [v.key, v]));

export const isValidVerification = (k) => k in VERIFICATION;
export const verificationLabel = (k) => VERIFICATION[k]?.label ?? null;

/** Estado que corresponde a una verificación. `null` = sin verificar → pendiente. */
export function statusDeVerificacion(k) {
  return VERIFICATION[k]?.status ?? "pending";
}

export const INCIDENCIA_PRIORITY = {
  low: { key: "low", label: "Baja" },
  medium: { key: "medium", label: "Media" },
  high: { key: "high", label: "Alta" },
};

const CATEGORY_LABEL = Object.fromEntries(INCIDENCIA_CATEGORIES.map((c) => [c.key, c.label]));

export const isValidCategory = (k) => k in CATEGORY_LABEL;
export const isValidStatus = (k) => k in INCIDENCIA_STATUS;
export const isValidPriority = (k) => k in INCIDENCIA_PRIORITY;
export const categoryLabel = (k) => CATEGORY_LABEL[k] ?? k;
export const statusLabel = (k) => INCIDENCIA_STATUS[k]?.label ?? k;
export const priorityLabel = (k) => INCIDENCIA_PRIORITY[k]?.label ?? k;

function initials(name) {
  return String(name || "?")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function miniMember(m) {
  if (!m) return null;
  const j = m.toJSON ? m.toJSON() : m;
  return { id: j.id, name: j.displayName, initials: initials(j.displayName), color: j.avatarColor ?? "#1B3A2D" };
}

function miniPatient(p) {
  if (!p) return null;
  const j = p.toJSON ? p.toJSON() : p;
  const name = [j.firstName, j.lastName].filter(Boolean).join(" ");
  return { id: j.id, name };
}

const isoDate = (d) => {
  if (!d) return null;
  const s = typeof d === "string" ? d : new Date(d).toISOString();
  return s.slice(0, 10);
};

/** Serializa una incidencia a la forma que consume el frontend. */
export function serializeIncidencia(row) {
  const j = row.toJSON ? row.toJSON() : row;
  const comments = Array.isArray(j.comments) ? j.comments : [];
  return {
    id: j.id,
    date: isoDate(j.incidenceDate),
    title: j.title,
    description: j.description ?? null,
    category: j.category,
    categoryLabel: categoryLabel(j.category),
    subcategory: j.subcategory ?? null,
    status: j.status,
    statusLabel: statusLabel(j.status),
    statusLevel: INCIDENCIA_STATUS[j.status]?.level ?? "gray",
    priority: j.priority,
    priorityLabel: priorityLabel(j.priority),
    patientId: j.patientId ?? null,
    patient: miniPatient(j.patient),
    clientId: j.clientId ?? null,
    assignedToId: j.assignedToId ?? null,
    assignedTo: miniMember(j.assignedTo),
    // Lista completa de responsables. Si la incidencia es anterior al
    // multi-responsable, la pivote está vacía y se cae al legacy para que la
    // UI no la enseñe "sin responsable" cuando sí tiene uno.
    assignees: Array.isArray(j.assignees) && j.assignees.length
      ? j.assignees.map(miniMember).filter(Boolean)
      : [miniMember(j.assignedTo)].filter(Boolean),
    reportedById: j.reportedById ?? null,
    reportedBy: miniMember(j.reportedBy),
    comments: comments.map((c) => ({
      authorId: c.authorId ?? null,
      authorName: c.authorName ?? "—",
      text: c.text ?? "",
      at: c.at ?? null,
    })),
    resolution: j.resolution ?? null,
    verification: j.verification ?? null,
    verificationLabel: verificationLabel(j.verification),
    verificationLevel: VERIFICATION[j.verification]?.level ?? null,
    resolvedAt: j.resolvedAt ?? null,
    // La falta (03/09/2026, AV-0038): null en las de siempre. Ver lib/clinica/faltas.js.
    falta: j.falta && typeof j.falta === "object" ? j.falta : null,
    faltaResumen: resumenFalta(j.falta && typeof j.falta === "object" ? j.falta : null),
    createdAt: j.createdAt ?? null,
    // Se mueve también al comentar (el append pone updated_at = now()): el
    // modal lo usa para saber si la copia del listado se ha quedado vieja.
    updatedAt: j.updatedAt ?? null,
  };
}

// ── Multi-responsable (sprint 2026-07-29) ───────────────────────────────────
// Una incidencia puede estar a cargo de VARIAS personas (mismo patrón que el
// Kanban de Proyectos con task_assignees). El campo antiguo `assignedToId` se
// mantiene como ESPEJO del primer responsable: hay filtros, vistas y el
// "mine=1" que siguen leyéndolo, y romperlos no aportaba nada.

const UUID_INCIDENCIA_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Responsables que llegan del formulario → ids válidos, únicos y en orden.
 * Acepta `assigneeIds` (nuevo) y cae a `assignedToId` (uno solo) para que un
 * cliente antiguo de la API siga funcionando.
 */
export function responsablesDe(body) {
  const crudos = Array.isArray(body?.assigneeIds)
    ? body.assigneeIds
    : body?.assignedToId
      ? [body.assignedToId]
      : [];
  const out = [];
  for (const v of crudos) {
    const id = typeof v === "string" ? v.trim() : "";
    if (UUID_INCIDENCIA_RE.test(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Deja la tabla pivote igual a `ids` y sincroniza el espejo `assignedToId`.
 * Descarta los ids que no existan como TeamMember (un formulario viejo o un
 * id de otro tenant no debe crear una fila colgando de la nada).
 */
export async function sincronizarResponsables(incidencia, ids, tenantModels) {
  const existentes = ids.length
    ? (await tenantModels.TeamMember.findAll({ where: { id: ids }, attributes: ["id"] })).map((t) => t.id)
    : [];
  const ordenados = ids.filter((id) => existentes.includes(id)); // se respeta el orden del formulario
  await incidencia.setAssignees(ordenados);
  const espejo = ordenados[0] ?? null;
  if (incidencia.assignedToId !== espejo) await incidencia.update({ assignedToId: espejo });
  return ordenados;
}
