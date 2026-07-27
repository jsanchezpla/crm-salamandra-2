/**
 * lib/citas/suggestSlots.js — cerebro de "proponer 3 horarios con IA".
 *
 * Principio: el SISTEMA genera candidatos VÁLIDOS (respetan horario + no solapan)
 * y la IA solo ELIGE/ORDENA/JUSTIFICA 3. La IA nunca inventa fechas: no conoce la
 * ocupación real y alucinaría solapes. Modos: Claude real (BYOK), SIMULADO
 * (dev/demo, 0 coste) o sin-IA (elige 3 repartidos). El endpoint re-valida al final.
 *
 * (Fichero nuevo en /lib, regla #2: encapsula la generación de candidatos + el
 * dispatch de IA, reutilizado por el endpoint suggest-slots.)
 */
import { generateSlotsForDay, getMadridDayOfWeek, getMadridParts } from "./slots.js";
import { complete } from "../outreach/analysis/anthropic.js";

export function suggestFakeEnabled() {
  return (
    (process.env.CITAS_FAKE_AI === "1" ||
      process.env.ASSISTANT_FAKE_AI === "1" ||
      process.env.OUTREACH_FAKE_AI === "1") &&
    process.env.NODE_ENV !== "production"
  );
}

const fmtDT = (iso) =>
  new Date(iso).toLocaleString("es-ES", {
    weekday: "long", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Madrid",
  });

/**
 * Genera candidatos VÁLIDOS a partir del horario propio de cada profesional
 * menos sus citas. `members` = [{ id, name, hours:[{dayOfWeek,startTime,endTime}],
 * bookings:[{scheduledAt,duration}] }]. `centerAvailabilities` es el fallback
 * (Availability global) para profesionales sin horario propio configurado.
 * Devuelve [{ slotId, datetime, teamMemberId, teamMemberName, label }].
 */
export function buildCandidates({ eventType, members, horizonDays = 14, now = new Date(), centerAvailabilities = [] }) {
  const out = [];
  for (let i = 1; i <= horizonDays; i++) {
    const dayDate = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    const p = getMadridParts(dayDate);
    const date = { year: p.year, month: p.month, day: p.day };
    const dow = getMadridDayOfWeek(dayDate);
    for (const m of members) {
      const own = (m.hours || []).filter((h) => Number(h.dayOfWeek) === dow);
      // Fallback: si el profesional no tiene NINGÚN horario propio, usa el del centro.
      const avail = (m.hours || []).length === 0
        ? centerAvailabilities.filter((a) => a.dayOfWeek === dow)
        : own;
      if (avail.length === 0) continue;
      const slots = generateSlotsForDay({
        eventType,
        availabilities: avail,
        date,
        existingBookings: m.bookings || [],
        now,
      });
      for (const s of slots) {
        out.push({
          slotId: `${m.id}|${s.datetime}`,
          datetime: s.datetime,
          teamMemberId: m.id,
          teamMemberName: m.name,
          label: fmtDT(s.datetime),
        });
      }
    }
  }
  out.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
  return out;
}

/** Reparte N candidatos en `k` elecciones lo más separadas posible. */
function spread(cands, k = 3) {
  if (cands.length <= k) return cands.slice();
  const step = (cands.length - 1) / (k - 1);
  const out = [];
  for (let i = 0; i < k; i++) out.push(cands[Math.round(i * step)]);
  return out;
}

function stripFences(text) {
  return String(text || "").replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
}

/**
 * Elige 3 de entre los candidatos. Devuelve { model, suggestions:[{slotId, reason}] }.
 */
export async function chooseSlots({ candidates, context, apiKey, model, forceFake = false }) {
  if (candidates.length === 0) return { model: "none", suggestions: [] };

  // forceFake = demo pública: modo simulado, sin llamar a la API real.
  if (suggestFakeEnabled() || forceFake) {
    return {
      model: "fake",
      suggestions: spread(candidates, 3).map((c, i) => ({
        slotId: c.slotId,
        reason: `[SIMULADO] Opción ${i + 1}: ${c.label} con ${c.teamMemberName || "el profesional"} — hueco libre y pronto.`,
      })),
    };
  }

  if (!apiKey) {
    // Sin IA: repartir 3 con motivo genérico.
    return {
      model: "sin-ia",
      suggestions: spread(candidates, 3).map((c) => ({ slotId: c.slotId, reason: `Hueco libre: ${c.label}.` })),
    };
  }

  // Acotar la lista que ve el modelo (coste/tokens).
  const shortlist = candidates.slice(0, 40);
  const system = [
    "Eres un asistente de agenda de un centro sanitario. Te doy una lista de huecos LIBRES y ya VÁLIDOS (id, fecha/hora, profesional).",
    "Elige los 3 MEJORES para reprogramar la cita, priorizando: cuanto antes mejor, repartir carga entre profesionales y las preferencias del usuario si las hay.",
    "Devuelve EXCLUSIVAMENTE JSON válido, sin texto alrededor, con esta forma exacta:",
    '{"suggestions":[{"slotId":"<id de la lista>","reason":"motivo corto en español"}]}',
    "Usa SOLO slotId que estén en la lista. Exactamente 3 (o menos si hay menos huecos). NO inventes fechas ni ids.",
  ].join("\n");
  const user = [
    `Servicio: ${context.serviceName || "cita"} · duración ${context.duration} min.`,
    context.patientName ? `Paciente: ${context.patientName}.` : "",
    context.preferences ? `Preferencias del usuario: ${context.preferences}.` : "",
    `Ámbito: ${context.scope === "company" ? "todo el centro (varios profesionales)" : "un solo profesional"}.`,
    "",
    "Huecos disponibles:",
    ...shortlist.map((c) => `- ${c.slotId} :: ${c.label} :: ${c.teamMemberName || "sin profesional"}`),
  ].filter(Boolean).join("\n");

  const raw = await complete({ system, user, model, maxTokens: 700, apiKey });
  let parsed;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    // Si el modelo no devolvió JSON usable, caemos a repartir 3 (no romper el flujo).
    return {
      model,
      suggestions: spread(candidates, 3).map((c) => ({ slotId: c.slotId, reason: `Hueco libre: ${c.label}.` })),
    };
  }
  const valid = new Set(candidates.map((c) => c.slotId));
  const suggestions = (Array.isArray(parsed?.suggestions) ? parsed.suggestions : [])
    .filter((s) => s && valid.has(s.slotId))
    .slice(0, 3)
    .map((s) => ({ slotId: s.slotId, reason: String(s.reason || "").slice(0, 200) || "Hueco libre." }));

  // Si la IA devolvió menos de 3 válidos, completar con candidatos repartidos.
  if (suggestions.length < 3) {
    const used = new Set(suggestions.map((s) => s.slotId));
    for (const c of spread(candidates, 3)) {
      if (suggestions.length >= 3) break;
      if (!used.has(c.slotId)) { suggestions.push({ slotId: c.slotId, reason: `Hueco libre: ${c.label}.` }); used.add(c.slotId); }
    }
  }
  return { model, suggestions };
}
