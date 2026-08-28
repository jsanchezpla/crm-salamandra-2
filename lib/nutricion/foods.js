/**
 * lib/nutricion/foods.js — utilidades del catálogo de alimentos
 * (Sprint nutri-laura Recetario C1).
 *
 * Incluye:
 *   - HOUSEHOLD_MEASURES_SEED: medidas caseras por defecto que se aplican
 *     cuando se crea cualquier alimento sin household_measures.
 *   - slugifyName: helper para auto-generar slug a partir del nombre.
 *   - sanitizeMeasures: valida y normaliza el array que envía el cliente.
 *   - parseNullableDecimal: validación común de macros opcionales.
 *   - searchOpenFoodFacts / fetchOpenFoodFactsByCode: proxies a la API
 *     pública de OpenFoodFacts con timeout y normalización del payload.
 *
 * No lanza errores; los proxies devuelven `{ items: [], external_error: true }`
 * cuando OFF falla, para que el endpoint pueda responder 200 con flag.
 */

export const HOUSEHOLD_MEASURES_SEED = Object.freeze([
  { label: "1 cucharada", grams: 15 },
  { label: "1 cucharadita", grams: 5 },
  { label: "1 unidad pequeña", grams: 50 },
  { label: "1 unidad mediana", grams: 80 },
  { label: "1 unidad grande", grams: 120 },
  { label: "1 puñado", grams: 30 },
  { label: "1 taza", grams: 240 },
  { label: "1 vaso", grams: 250 },
  { label: "1 lata", grams: 120 },
]);

export function slugifyName(name) {
  if (!name || typeof name !== "string") return null;
  const slug = name
    .toString()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
  return slug || null;
}

/**
 * Normaliza un string para búsqueda case+accent insensitive (versión JS).
 * Devuelve la string en minúsculas y sin diacríticos (NFD + strip de
 * combining marks). Útil como fallback in-process si la extensión
 * `unaccent` de Postgres no está disponible en la BD.
 *
 *   normalizeForSearch("Pavó con Cebáda") === "pavo con cebada"
 */
export function normalizeForSearch(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// `hasUnaccentSupport` se ha mudado a `lib/utils/busqueda.js` (28/08/2026).
// Aquí nació —el catálogo de alimentos fue quien primero necesitó buscar sin
// tildes—, pero desde que Pacientes busca igual es una pieza transversal, y
// dejarla dentro de Nutrición obligaba al resto del CRM a importar de este
// módulo para buscar. Se sigue exportando desde aquí para no tocar a quien ya
// la importaba (`app/api/nutricion/foods/route.js`).
export { hasUnaccentSupport } from "../utils/busquedaDb.js";

export const DEFAULT_UNITS = new Set(["g", "ml", "unidad"]);

export function parseNullableDecimal(value, { min = 0, max = 1000 } = {}) {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  const n = Number(value);
  if (!Number.isFinite(n)) return { ok: false, error: "valor numérico inválido" };
  if (n < min) return { ok: false, error: `valor no puede ser < ${min}` };
  if (n > max) return { ok: false, error: `valor no puede ser > ${max}` };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

export function sanitizeMeasures(input) {
  if (input === undefined) return { ok: true, value: undefined };
  if (input === null) return { ok: true, value: [] };
  if (!Array.isArray(input)) return { ok: false, error: "household_measures debe ser un array" };
  const out = [];
  for (let i = 0; i < input.length; i++) {
    const m = input[i];
    if (!m || typeof m !== "object") return { ok: false, error: `medida[${i}] inválida` };
    const label = typeof m.label === "string" ? m.label.trim() : "";
    if (!label) return { ok: false, error: `medida[${i}].label requerido` };
    const grams = Number(m.grams);
    if (!Number.isFinite(grams) || grams <= 0 || grams > 10000) {
      return { ok: false, error: `medida[${i}].grams inválido` };
    }
    out.push({ label, grams: Math.round(grams * 100) / 100 });
  }
  return { ok: true, value: out };
}

export function sanitizeTags(input) {
  if (input === undefined) return { ok: true, value: undefined };
  if (input === null) return { ok: true, value: [] };
  if (!Array.isArray(input)) return { ok: false, error: "tags debe ser un array de strings" };
  const out = [];
  for (const t of input) {
    if (typeof t !== "string") return { ok: false, error: "tags contiene un valor no-string" };
    const trimmed = t.trim();
    if (!trimmed) continue;
    if (trimmed.length > 60) return { ok: false, error: "un tag supera los 60 caracteres" };
    if (!out.includes(trimmed)) out.push(trimmed);
  }
  return { ok: true, value: out };
}

// La integración con OpenFoodFacts (proxy de búsqueda + import) se retiró en el
// sprint Nutrinotas (2026-07-18) a petición de la nutricionista: el catálogo base
// se siembra localmente (scripts/seed-foods-base-catalog.js) y el resto se añade
// a mano. Las filas ya importadas conservan source='openfoodfacts' en BD.
