/**
 * lib/calendar/reorganizeWeek.js — cerebro de "reorganizar la semana con IA".
 *
 * Mira las tareas de la semana y SIEMPRE devuelve TRES propuestas distintas de
 * cómo repartirlas por los días de la MISMA semana. Cada propuesta es una
 * ESTRATEGIA con su propio conjunto de movimientos (mover la tarea X del día A
 * al día B). El usuario navega entre las 3 y aplica la que quiera.
 *
 * Estrategias deterministas (fake / sin-IA):
 *   1) Equilibrar la semana  — reparte para que ningún día quede saturado.
 *   2) Prioridades al principio — adelanta lo importante, aplaza lo menos urgente.
 *   3) Cambios mínimos — solo aligera el día más cargado.
 *
 * Modos: Claude real (BYOK), SIMULADO (dev/demo) o sin-IA (determinista). La IA
 * solo propone MOVES sobre taskIds y días REALES de la semana; el endpoint valida.
 *
 * (Fichero en /lib, regla #2.)
 */
import { complete } from "../outreach/analysis/anthropic.js";

export function reorgFakeEnabled() {
  return (
    (process.env.CALENDAR_FAKE_AI === "1" ||
      process.env.ASSISTANT_FAKE_AI === "1" ||
      process.env.OUTREACH_FAKE_AI === "1") &&
    process.env.NODE_ENV !== "production"
  );
}

function stripFences(t) {
  return String(t || "").replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
}

const P_RANK = { high: 0, medium: 1, low: 2 };
// weekDates[0] es SIEMPRE lunes (el endpoint construye la semana desde el lunes).
const DAY_LABELS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

function prioEs(p) {
  return p === "high" ? "alta" : p === "low" ? "baja" : "media";
}
function labelOf(dateStr, weekDates) {
  const i = weekDates.indexOf(dateStr);
  return i >= 0 ? DAY_LABELS[i] : dateStr;
}
function loadByDay(tasks, weekDates) {
  const byDay = Object.fromEntries(weekDates.map((d) => [d, []]));
  for (const t of tasks) if (byDay[t.startDate]) byDay[t.startDate].push(t);
  return byDay;
}

/** Estrategia 1 — equilibrar: mueve tareas non-high del día más cargado al más libre. */
function strategyBalance(tasks, weekDates) {
  const byDay = loadByDay(tasks, weekDates);
  const load = weekDates.map((d) => ({ d, n: byDay[d].length }));
  const moves = [];
  const moved = new Set();
  for (let i = 0; i < tasks.length; i++) {
    load.sort((a, b) => b.n - a.n);
    const max = load[0];
    const min = load[load.length - 1];
    if (max.n - min.n <= 1) break;
    const cand = byDay[max.d]
      .filter((t) => t.priority !== "high" && !moved.has(t.id))
      .sort((a, b) => P_RANK[b.priority] - P_RANK[a.priority])[0]; // primero la de menor prioridad
    if (!cand) break;
    moved.add(cand.id);
    moves.push({
      taskId: cand.id,
      newDate: min.d,
      reason: `El ${labelOf(max.d, weekDates)} iba cargado; la muevo al ${labelOf(min.d, weekDates)} para igualar la semana.`,
    });
    max.n -= 1;
    min.n += 1;
  }
  return moves;
}

/** Estrategia 2 — prioridades al principio: alta pronto, baja/media al final. */
function strategyPriorityFirst(tasks, weekDates) {
  const zones = { high: [0, 1, 2], medium: [2, 3, 4], low: [4, 5, 6] };
  const byDay = loadByDay(tasks, weekDates);
  const count = weekDates.map((d) => byDay[d].length);
  const moves = [];
  const ordered = [...tasks].sort((a, b) => P_RANK[a.priority] - P_RANK[b.priority]); // altas primero
  for (const t of ordered) {
    const curIdx = weekDates.indexOf(t.startDate);
    if (curIdx < 0) continue;
    const zone = zones[t.priority] || [0, 1, 2, 3, 4, 5, 6];
    if (zone.includes(curIdx)) continue; // ya está en su franja
    let best = null;
    for (const zi of zone) {
      if (zi === curIdx) continue;
      if (best === null || count[zi] < count[best]) best = zi;
    }
    if (best === null || best === curIdx) continue;
    count[curIdx] -= 1;
    count[best] += 1;
    const dir = best < curIdx ? "adelanto" : "aplazo";
    moves.push({
      taskId: t.id,
      newDate: weekDates[best],
      reason: `Prioridad ${prioEs(t.priority)}: la ${dir} al ${DAY_LABELS[best]} para dejar lo importante al principio de la semana.`,
    });
  }
  return moves;
}

/** Estrategia 3 — cambios mínimos: solo descarga el día pico a los más vacíos. */
function strategyMinimal(tasks, weekDates) {
  const byDay = loadByDay(tasks, weekDates);
  const load = weekDates.map((d) => ({ d, n: byDay[d].length }));
  const sorted = [...load].sort((a, b) => b.n - a.n);
  const peak = sorted[0];
  const lightest = sorted[sorted.length - 1];
  if (!peak || peak.n - lightest.n <= 1) return [];
  const second = sorted[1]?.n ?? 0;
  const targetN = Math.max(second, Math.ceil(tasks.length / weekDates.length), 1);
  let toMove = Math.max(1, peak.n - targetN);
  const cands = byDay[peak.d]
    .filter((t) => t.priority !== "high")
    .sort((a, b) => P_RANK[b.priority] - P_RANK[a.priority]); // menor prioridad primero
  const empties = weekDates
    .map((d) => ({ d, n: byDay[d].length }))
    .filter((x) => x.d !== peak.d)
    .sort((a, b) => a.n - b.n);
  const moves = [];
  let ei = 0;
  for (const cand of cands) {
    if (moves.length >= toMove || !empties.length) break;
    const dest = empties[ei % empties.length];
    dest.n += 1;
    ei += 1;
    moves.push({
      taskId: cand.id,
      newDate: dest.d,
      reason: `Solo aligero el ${labelOf(peak.d, weekDates)} (el día más cargado); muevo lo menos urgente al ${labelOf(dest.d, weekDates)}.`,
    });
  }
  return moves;
}

const STRATEGIES = [
  { key: "balance", title: "Equilibrar la semana", description: "Reparte las tareas para que ningún día quede saturado.", fn: strategyBalance },
  { key: "priority", title: "Prioridades al principio", description: "Adelanta lo importante y aplaza lo menos urgente al final de la semana.", fn: strategyPriorityFirst },
  { key: "minimal", title: "Cambios mínimos", description: "Solo aligera el día más cargado, moviendo lo imprescindible.", fn: strategyMinimal },
];

function deterministicProposals(tasks, weekDates, tag = "") {
  return STRATEGIES.map((s) => {
    const moves = s.fn(tasks, weekDates).map((m) => (tag ? { ...m, reason: `${tag} ${m.reason}` } : m));
    return { key: s.key, title: s.title, description: s.description, moves };
  });
}

function emptyProposals() {
  return STRATEGIES.map((s) => ({ key: s.key, title: s.title, description: s.description, moves: [] }));
}

/**
 * Devuelve SIEMPRE { model, proposals } con exactamente 3 propuestas.
 * Cada propuesta: { key, title, description, moves:[{taskId,newDate,reason}] }.
 */
export async function reorganizeWeek({ tasks, weekDates, apiKey, model, preferences = "" }) {
  if (!tasks.length) return { model: "none", proposals: emptyProposals() };

  if (reorgFakeEnabled()) {
    return { model: "fake", proposals: deterministicProposals(tasks, weekDates, "[SIMULADO]") };
  }
  if (!apiKey) {
    return { model: "sin-ia", proposals: deterministicProposals(tasks, weekDates) };
  }

  const system = [
    "Eres un asistente que reorganiza la agenda SEMANAL de tareas de un equipo.",
    "Te doy las tareas de la semana (id, título, prioridad, día actual, profesional).",
    "Devuelve SIEMPRE TRES propuestas DISTINTAS de cómo repartir las tareas por OTROS días de la MISMA semana, cada una con un criterio diferente:",
    "  1) Equilibrar la semana: que ningún día quede saturado.",
    "  2) Prioridades al principio: lo de prioridad alta pronto, lo menos urgente hacia el final.",
    "  3) Cambios mínimos: tocar lo menos posible, solo aligerar el día más cargado.",
    "Devuelve EXCLUSIVAMENTE JSON válido con esta forma exacta:",
    '{"proposals":[{"title":"...","description":"...","moves":[{"taskId":"<id de la lista>","newDate":"YYYY-MM-DD","reason":"motivo corto en español, indicando a qué profesional afecta"}]}]}',
    "Usa SOLO taskId de la lista y newDate entre los días de la semana indicados. No inventes ids ni fechas. Si una propuesta no necesita mover nada, deja su lista de moves vacía.",
  ].join("\n");
  const user = [
    `Semana: ${weekDates[0]} (lunes) a ${weekDates[weekDates.length - 1]} (domingo).`,
    preferences ? `Preferencias: ${preferences}.` : "",
    "",
    "Tareas (id · prioridad · día actual · título · profesional):",
    ...tasks.slice(0, 80).map((t) => `- ${t.id} · ${t.priority} · ${t.startDate} · ${t.title} · ${t.teamMemberName || "sin asignar"}`),
  ].filter(Boolean).join("\n");

  let raw;
  try {
    raw = await complete({ system, user, model, maxTokens: 1600, apiKey });
  } catch {
    return { model: "sin-ia", proposals: deterministicProposals(tasks, weekDates) };
  }
  let parsed;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    return { model, proposals: deterministicProposals(tasks, weekDates) };
  }

  const ids = new Set(tasks.map((t) => t.id));
  const days = new Set(weekDates);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const rawProps = Array.isArray(parsed?.proposals) ? parsed.proposals : [];
  const proposals = rawProps.slice(0, 3).map((p, idx) => {
    const moves = (Array.isArray(p?.moves) ? p.moves : [])
      .filter((m) => m && ids.has(m.taskId) && days.has(m.newDate) && byId.get(m.taskId)?.startDate !== m.newDate)
      .slice(0, 30)
      .map((m) => ({ taskId: m.taskId, newDate: m.newDate, reason: String(m.reason || "").slice(0, 240) || "Repartir carga." }));
    return {
      key: `ia-${idx + 1}`,
      title: String(p?.title || `Propuesta ${idx + 1}`).slice(0, 80),
      description: String(p?.description || "").slice(0, 200),
      moves,
    };
  });
  // Garantizar SIEMPRE 3 propuestas: rellenar con deterministas si Claude dio menos.
  if (proposals.length < 3) {
    const det = deterministicProposals(tasks, weekDates);
    for (let i = proposals.length; i < 3; i++) proposals.push(det[i]);
  }
  return { model, proposals };
}
