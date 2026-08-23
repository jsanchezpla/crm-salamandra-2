/**
 * Normalización defensiva del plan de proyecto que devuelve la IA.
 *
 * Nunca se confía en el modelo (mismo criterio que lib/outreach/analysis/
 * schema.js): se quitan vallas de markdown, se fuerzan tipos, se acotan
 * longitudes y se filtran en silencio los ids de asignados que no existan en
 * el equipo. Un JSON que no parsea o sin nombre de proyecto lanza
 * ValidationError con un mensaje apto para enseñar al usuario.
 *
 * El endpoint /api/projects/ai/create RE-normaliza el plan recibido del
 * cliente con esta misma función: el plan que viaja por el navegador es
 * input hostil como cualquier otro.
 */

import { ValidationError } from "../../utils/errors.js";

const INVALID_PLAN_MSG = "La IA no ha devuelto un plan válido, prueba a reformular el prompt";

const PRIORITY_VALUES = ["low", "medium", "high", "urgent"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_PHASES = 12;
const MAX_TASKS_TOTAL = 60;
const MAX_MILESTONES = 15;
const MAX_CHECKLIST = 15;
const MAX_TAGS = 10;

/** Quita vallas ```json ... ``` por si el modelo las añade pese al prompt. */
function stripFences(text) {
  const t = String(text ?? "").trim();
  const match = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : t;
}

function toText(value, max = null) {
  if (typeof value !== "string") return "";
  const t = value.trim();
  return max != null ? t.slice(0, max) : t;
}

function toTextOrNull(value, max = null) {
  const t = toText(value, max);
  return t || null;
}

/** "YYYY-MM-DD" válida (existe en calendario) o null. */
function toDateOnly(value) {
  if (typeof value !== "string" || !DATE_RE.test(value.trim())) return null;
  const t = value.trim();
  const d = new Date(`${t}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10) === t ? t : null;
}

function toPriority(value, fallback = "medium") {
  return PRIORITY_VALUES.includes(value) ? value : fallback;
}

/** Número >= 0 o null. Acepta strings numéricas ("8"). */
function toHours(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function toStringList(value, max) {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean)
    .slice(0, max);
}

/**
 * El equipo indexado por id en MINÚSCULAS → id canónico (el de la base).
 *
 * 21/08/2026 — `UUID_RE` lleva `/i` a propósito, pero la comprobación contra el
 * equipo era exacta (`teamIds.has(id)`). El modelo copia los ids del prompt y
 * no garantiza la caja: un `aaaa…` devuelto como `AAAA…` pasaba la regex,
 * fallaba el `has` y se descartaba como si fuera de otro tenant. Y el fallo era
 * MUDO —aquí no hay warnings—: el plan salía sin asignar a nadie y no había
 * forma de saber por qué. Se busca por minúsculas y se devuelve SIEMPRE el id
 * del equipo, no el que escribió el modelo: lo que acaba en la FK tiene que ser
 * el valor de la base, no una variante suya.
 */
function indexarEquipo(teamMembers) {
  const porClave = new Map();
  for (const m of Array.isArray(teamMembers) ? teamMembers : []) {
    const id = typeof m?.id === "string" ? m.id : "";
    if (id) porClave.set(id.toLowerCase(), id);
  }
  return porClave;
}

/** El id canónico de esa persona en el equipo, o "" si no es del equipo. */
function idDelEquipo(value, equipo) {
  if (typeof value !== "string") return "";
  const id = value.trim();
  if (!UUID_RE.test(id)) return "";
  return equipo.get(id.toLowerCase()) ?? "";
}

/** Filtra en silencio los uuids que no pertenezcan al equipo. */
function toAssigneeIds(value, equipo) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const raw of value) {
    const id = idDelEquipo(raw, equipo);
    if (!id || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

/**
 * `normalizePlan(raw, { teamMembers })` → plan saneado, o lanza ValidationError.
 * `raw` puede ser el texto crudo de la IA (string) o un objeto ya parseado
 * (p. ej. el plan reenviado por el cliente en /ai/create).
 */
export function normalizePlan(raw, { teamMembers = [] } = {}) {
  let obj = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(stripFences(raw));
    } catch {
      throw new ValidationError(INVALID_PLAN_MSG);
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new ValidationError(INVALID_PLAN_MSG);
  }

  const equipo = indexarEquipo(teamMembers);

  const name = toText(obj.name, 200);
  if (!name) throw new ValidationError(INVALID_PLAN_MSG);

  const startDate = toDateOnly(obj.startDate);
  let dueDate = toDateOnly(obj.dueDate);
  if (startDate && dueDate && dueDate < startDate) dueDate = null;

  // ── Fases y tareas (tope global de tareas) ────────────────────────────────
  const phases = [];
  /**
   * Índice que escribió el modelo → índice en `phases`. Los hitos apuntan a su
   * fase por posición, y aquí se descartan fases (sin nombre, o pasado el tope
   * de 12): sin esta traducción el `phaseIndex` de un hito se comparaba contra
   * la lista YA filtrada y se corría de sitio. Con phases [sin nombre, B, C],
   * el hito de B acababa colgado de C y el de C se perdía — y eso no se ve: es
   * un hito bien formado, en la fase equivocada, guardado en la base
   * (21/08/2026). Lo que apuntaba a una fase descartada queda en `null`, o sea
   * hito sin fase, que es la única lectura honesta.
   */
  const indiceDeFase = new Map();
  let totalTasks = 0;
  const rawPhases = Array.isArray(obj.phases) ? obj.phases.slice(0, MAX_PHASES) : [];
  for (const [indiceOriginal, rawPhase] of rawPhases.entries()) {
    if (!rawPhase || typeof rawPhase !== "object") continue;
    const phaseName = toText(rawPhase.name, 200);
    if (!phaseName) continue; // fase sin nombre: se descarta en silencio

    const phaseStart = toDateOnly(rawPhase.startDate);
    let phaseEnd = toDateOnly(rawPhase.endDate);
    if (phaseStart && phaseEnd && phaseEnd < phaseStart) phaseEnd = null;

    const tasks = [];
    const rawTasks = Array.isArray(rawPhase.tasks) ? rawPhase.tasks : [];
    for (const rawTask of rawTasks) {
      if (totalTasks >= MAX_TASKS_TOTAL) break;
      if (!rawTask || typeof rawTask !== "object") continue;
      const title = toText(rawTask.title, 255);
      if (!title) continue; // tarea sin título: se descarta en silencio
      tasks.push({
        title,
        description: toTextOrNull(rawTask.description),
        priority: toPriority(rawTask.priority),
        estimatedHours: toHours(rawTask.estimatedHours),
        dueDate: toDateOnly(rawTask.dueDate),
        assigneeIds: toAssigneeIds(rawTask.assigneeIds, equipo),
        checklist: toStringList(rawTask.checklist, MAX_CHECKLIST),
      });
      totalTasks += 1;
    }

    indiceDeFase.set(indiceOriginal, phases.length);
    phases.push({
      name: phaseName,
      description: toTextOrNull(rawPhase.description),
      startDate: phaseStart,
      endDate: phaseEnd,
      tasks,
    });
  }

  // ── Hitos (dueDate OBLIGATORIA: sin fecha se descarta) ────────────────────
  const milestones = [];
  const rawMilestones = Array.isArray(obj.milestones) ? obj.milestones : [];
  for (const rawMs of rawMilestones) {
    if (milestones.length >= MAX_MILESTONES) break;
    if (!rawMs || typeof rawMs !== "object") continue;
    const msName = toText(rawMs.name, 200);
    const msDue = toDateOnly(rawMs.dueDate);
    if (!msName || !msDue) continue;
    const idx = Number.isInteger(rawMs.phaseIndex) ? rawMs.phaseIndex : null;
    milestones.push({
      name: msName,
      dueDate: msDue,
      // El índice se TRADUCE (ver `indiceDeFase`), no se compara contra la
      // lista ya filtrada. Fuera de rango, negativo o apuntando a una fase que
      // se descartó → null: hito sin fase.
      phaseIndex: idx != null && indiceDeFase.has(idx) ? indiceDeFase.get(idx) : null,
    });
  }

  // ── Miembros (ids filtrados contra el equipo, sin duplicados) ─────────────
  const members = [];
  const seenMembers = new Set();
  const rawMembers = Array.isArray(obj.members) ? obj.members : [];
  for (const rawMember of rawMembers) {
    if (!rawMember || typeof rawMember !== "object") continue;
    const tmId = idDelEquipo(rawMember.teamMemberId, equipo);
    if (!tmId || seenMembers.has(tmId)) continue;
    seenMembers.add(tmId);
    members.push({
      teamMemberId: tmId,
      role: rawMember.role === "lead" ? "lead" : "member",
    });
  }

  return {
    name,
    description: toTextOrNull(obj.description),
    priority: toPriority(obj.priority),
    startDate,
    dueDate,
    estimatedHours: toHours(obj.estimatedHours),
    tags: toStringList(obj.tags, MAX_TAGS),
    phases,
    milestones,
    members,
  };
}
