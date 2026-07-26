/**
 * lib/calendar/reorganizeWeek.js — cerebro de "reorganizar la semana con IA".
 *
 * Mira las tareas de la semana y propone MOVER algunas a otros días de la misma
 * semana para repartir la carga (que ningún día quede saturado), manteniendo las
 * de prioridad alta pronto y sin mover más de lo necesario. Modos: Claude real
 * (BYOK), SIMULADO (dev/demo) o sin-IA (reparto determinista). La IA solo propone
 * MOVES sobre taskIds y días REALES de la semana; el endpoint valida y aplica.
 *
 * (Fichero nuevo en /lib, regla #2.)
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

/** Reparto determinista: mueve tareas non-high del día más cargado al más libre. */
function deterministicMoves(tasks, weekDates) {
  const byDay = Object.fromEntries(weekDates.map((d) => [d, []]));
  for (const t of tasks) if (byDay[t.startDate]) byDay[t.startDate].push(t);
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
      .sort((a, b) => P_RANK[b.priority] - P_RANK[a.priority])[0]; // primero las de menor prioridad
    if (!cand) break;
    moved.add(cand.id);
    moves.push({ taskId: cand.id, newDate: min.d, reason: `El ${max.d} iba cargado; movida al ${min.d} para repartir.` });
    max.n -= 1; min.n += 1;
  }
  return moves;
}

export async function reorganizeWeek({ tasks, weekDates, apiKey, model, preferences = "" }) {
  if (!tasks.length) return { model: "none", moves: [] };

  if (reorgFakeEnabled()) {
    const moves = deterministicMoves(tasks, weekDates).map((m) => ({ ...m, reason: `[SIMULADO] ${m.reason}` }));
    return { model: "fake", moves };
  }
  if (!apiKey) {
    return { model: "sin-ia", moves: deterministicMoves(tasks, weekDates) };
  }

  const system = [
    "Eres un asistente que reorganiza la agenda SEMANAL de tareas de un equipo.",
    "Te doy las tareas de la semana (id, título, prioridad, día actual, profesional).",
    "Propón mover algunas a OTROS días de la MISMA semana para REPARTIR la carga (que ningún día quede saturado), manteniendo las de prioridad ALTA lo antes posible y sin mover más de lo necesario.",
    "Devuelve EXCLUSIVAMENTE JSON válido con esta forma exacta:",
    '{"moves":[{"taskId":"<id de la lista>","newDate":"YYYY-MM-DD","reason":"motivo corto en español"}]}',
    "Usa SOLO taskId de la lista y newDate entre los días de la semana indicados. No incluyas tareas que ya estén bien colocadas. NO inventes ids ni fechas.",
  ].join("\n");
  const user = [
    `Semana: ${weekDates[0]} a ${weekDates[weekDates.length - 1]}.`,
    preferences ? `Preferencias: ${preferences}.` : "",
    "",
    "Tareas (id · prioridad · día actual · título · profesional):",
    ...tasks.slice(0, 80).map((t) => `- ${t.id} · ${t.priority} · ${t.startDate} · ${t.title} · ${t.teamMemberName || "sin asignar"}`),
  ].filter(Boolean).join("\n");

  let raw;
  try {
    raw = await complete({ system, user, model, maxTokens: 900, apiKey });
  } catch {
    return { model: "sin-ia", moves: deterministicMoves(tasks, weekDates) };
  }
  let parsed;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    return { model, moves: deterministicMoves(tasks, weekDates) };
  }
  const ids = new Set(tasks.map((t) => t.id));
  const days = new Set(weekDates);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const moves = (Array.isArray(parsed?.moves) ? parsed.moves : [])
    .filter((m) => m && ids.has(m.taskId) && days.has(m.newDate) && byId.get(m.taskId)?.startDate !== m.newDate)
    .slice(0, 20)
    .map((m) => ({ taskId: m.taskId, newDate: m.newDate, reason: String(m.reason || "").slice(0, 200) || "Repartir carga." }));
  return { model, moves };
}
