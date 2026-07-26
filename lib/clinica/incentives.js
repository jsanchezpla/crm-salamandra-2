/**
 * Incentivos de desempeño — cálculo REAL y transparente.
 *
 * Hasta ahora la puntuación total y el incentivo propuesto eran datos de
 * relleno (venían de la semilla). Aquí se define:
 *   - la puntuación total como media ponderada REAL de las áreas puntuadas,
 *     usando los pesos de `performanceAreas.js`;
 *   - el incentivo propuesto según una TABLA DE TRAMOS que Dirección define
 *     (puntuación total → importe €), guardada en `tenant.settings.clinica.
 *     incentiveTiers`. Si el tenant no la ha configurado, se usa el default.
 *
 * Dirección siempre puede AJUSTAR el importe a mano por persona (approvedIncentive);
 * eso vive en el endpoint de aprobación, no aquí.
 */

import { PERFORMANCE_AREAS } from "./performanceAreas.js";

/**
 * Tramos por defecto: puntuación total (0-100) → incentivo €.
 * Cada tramo aplica DESDE su `from` (incluido) hasta el `from` del siguiente
 * (excluido). Aproxima "a más puntuación, más incentivo", pero es solo el punto
 * de partida: Dirección lo edita en el panel.
 */
export const DEFAULT_INCENTIVE_TIERS = [
  { from: 0, amount: 0 },
  { from: 60, amount: 100 },
  { from: 70, amount: 200 },
  { from: 80, amount: 350 },
  { from: 90, amount: 500 },
];

/**
 * Normaliza/valida una tabla de tramos (venida del cliente o de settings):
 *   - cada tramo { from: entero 0..100, amount: >= 0 };
 *   - se ordena ascendente por `from` y se deduplica (último gana);
 *   - se garantiza un tramo base en `from=0` para que SIEMPRE haya respuesta.
 * Devuelve null si la entrada no es un array o no queda ningún tramo válido.
 */
export function normalizeTiers(raw) {
  if (!Array.isArray(raw)) return null;
  const byFrom = new Map();
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    let from = Math.round(Number(t.from));
    let amount = Number(t.amount);
    if (!Number.isFinite(from) || !Number.isFinite(amount)) continue;
    from = Math.max(0, Math.min(100, from));
    amount = Math.max(0, Math.round(amount * 100) / 100);
    byFrom.set(from, { from, amount }); // último gana
  }
  if (byFrom.size === 0) return null;
  const clean = [...byFrom.values()].sort((a, b) => a.from - b.from);
  if (clean[0].from !== 0) clean.unshift({ from: 0, amount: 0 });
  return clean;
}

/** Tramos efectivos de un tenant: los suyos (settings) o el default. */
export function tiersFromTenant(tenant) {
  return normalizeTiers(tenant?.settings?.clinica?.incentiveTiers) ?? DEFAULT_INCENTIVE_TIERS;
}

/**
 * Incentivo propuesto para una puntuación total, según la tabla de tramos.
 * Devuelve el importe del tramo más alto cuyo `from` no supera la puntuación.
 */
export function proposeIncentive(totalScore, tiers = DEFAULT_INCENTIVE_TIERS) {
  if (totalScore == null || !Number.isFinite(Number(totalScore))) return 0;
  const s = Number(totalScore);
  const sorted = [...tiers].sort((a, b) => a.from - b.from);
  let amount = 0;
  for (const t of sorted) {
    if (s >= t.from) amount = t.amount;
    else break;
  }
  return amount;
}

/**
 * Puntuación total (0-100): media ponderada de las áreas puntuadas usando los
 * pesos de PERFORMANCE_AREAS. Las áreas sin valor NO cuentan (se renormaliza por
 * el peso de las que sí tienen). Devuelve null si no hay ninguna área puntuada.
 *
 * `scores` va cotejado por clave de área ("area1", "area2"…), no por columna.
 */
export function computeTotalScore(scores) {
  let acc = 0;
  let w = 0;
  for (const a of PERFORMANCE_AREAS) {
    const v = scores?.[a.key];
    if (v == null || !Number.isFinite(Number(v))) continue;
    acc += Number(v) * a.weight;
    w += a.weight;
  }
  if (w === 0) return null;
  return Math.round(acc / w);
}
