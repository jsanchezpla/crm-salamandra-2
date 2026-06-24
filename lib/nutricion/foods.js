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

const OFF_BASE = "https://world.openfoodfacts.org";
const OFF_TIMEOUT_MS = 8000;

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

// Cache por instancia de Sequelize: ¿tiene esta BD la extensión `unaccent`?
// Detectamos una sola vez por proceso para no consultar pg_extension en cada
// request. Si falla la detección, conservadoramente devolvemos false y la API
// usa el path de fallback (ILIKE plain, sin accent-insensitive total).
const _unaccentSupportCache = new WeakMap();

export async function hasUnaccentSupport(sequelize) {
  if (!sequelize) return false;
  if (_unaccentSupportCache.has(sequelize)) {
    return _unaccentSupportCache.get(sequelize);
  }
  try {
    const [rows] = await sequelize.query(
      "SELECT 1 AS ok FROM pg_extension WHERE extname = 'unaccent' LIMIT 1"
    );
    const has = Array.isArray(rows) && rows.length > 0;
    _unaccentSupportCache.set(sequelize, has);
    return has;
  } catch {
    _unaccentSupportCache.set(sequelize, false);
    return false;
  }
}

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

// ─── OpenFoodFacts proxy ──────────────────────────────────────────────────────

function normalizeOffProduct(p) {
  if (!p || typeof p !== "object") return null;
  const code = p.code || p.id || p._id || null;
  if (!code) return null;
  const n = p.nutriments || {};
  return {
    external_id: String(code),
    name: (p.product_name_es || p.product_name || "").trim() || null,
    brand: (p.brands || "").trim() || null,
    protein_per_100: numericOrNull(n["proteins_100g"]),
    carbs_per_100: numericOrNull(n["carbohydrates_100g"]),
    fat_per_100: numericOrNull(n["fat_100g"]),
    fiber_per_100: numericOrNull(n["fiber_100g"]),
    source: "openfoodfacts",
  };
}

function numericOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchOff(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), OFF_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        // User-Agent EXIGIDO por OpenFoodFacts en formato
        // "AppName/version (contacto) - descripción". OFF responde 503 a
        // user-agents demasiado genéricos. Mantener este string completo.
        "User-Agent":
          "SalamandraCRM/1.0 (info@salamandrasolutions.com) - nutricion module",
        Accept: "application/json",
      },
    });
    if (!res.ok) return { ok: false };
    const json = await res.json().catch(() => null);
    return json ? { ok: true, json } : { ok: false };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(t);
  }
}

export async function searchOpenFoodFacts(query) {
  const q = (query ?? "").toString().trim();
  if (!q) return { items: [], external_error: false };
  const url = `${OFF_BASE}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=20&fields=code,product_name_es,product_name,brands,nutriments`;
  const r = await fetchOff(url);
  if (!r.ok) return { items: [], external_error: true };
  const products = Array.isArray(r.json.products) ? r.json.products : [];
  const items = products.map(normalizeOffProduct).filter(Boolean);
  return { items, external_error: false };
}

export async function fetchOpenFoodFactsByCode(code) {
  const c = (code ?? "").toString().trim();
  if (!c) return { item: null, external_error: false };
  const url = `${OFF_BASE}/api/v2/product/${encodeURIComponent(c)}.json?fields=code,product_name_es,product_name,brands,nutriments`;
  const r = await fetchOff(url);
  if (!r.ok) return { item: null, external_error: true };
  // OFF responde con { status: 1, product: {...} } cuando lo encuentra y
  // { status: 0 } cuando no.
  if (r.json.status === 1 && r.json.product) {
    return { item: normalizeOffProduct(r.json.product), external_error: false };
  }
  return { item: null, external_error: false };
}
