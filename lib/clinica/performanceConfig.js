/**
 * lib/clinica/performanceConfig.js — desempeño configurable por ROLES.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten los endpoints de performance,
 * el endpoint de configuración y sus serializers.)
 *
 * Cada tenant puede definir roles de desempeño (terapeuta, administración,
 * ventas…) con sus áreas, pesos, metas y umbrales de semáforo. La config vive
 * en `master.tenants.settings.clinica.performanceRoles` (JSONB), mismo
 * mecanismo que `incentiveTiers`.
 *
 * COMPATIBILIDAD CRÍTICA (aumenta está en producción con datos reales): un
 * tenant SIN config guardada se comporta EXACTAMENTE igual que antes — mismas
 * 7 áreas, mismos pesos y umbrales 85/70. Eso es LEGACY_ROLE, sintetizado de
 * PERFORMANCE_AREAS sin tocarlas.
 */

import { PERFORMANCE_AREAS } from "./performanceAreas.js";

// Iconos permitidos para las áreas: los 7 actuales + 9 nuevos. La UI tiene un
// SVG por cada uno; un icono fuera de la lista se sustituye por DEFAULT_ICON.
export const ALLOWED_ICONS = [
  "trending-up", "clock", "stack", "users", "chat", "heart", "share",
  "target", "star", "euro", "phone", "briefcase", "calendar", "shield", "book", "chart",
];
export const DEFAULT_ICON = "target";

// Umbrales del semáforo por defecto (los históricos de scoreToSemaforo).
export const DEFAULT_THRESHOLDS = { green: 85, amber: 70 };

const SLUG_RE = /^[a-z0-9_]{1,64}$/;
const MAX_ROLES = 20;
const MAX_AREAS = 15;

/**
 * Rol sintetizado con las áreas actuales de PERFORMANCE_AREAS. Es lo que se usa
 * cuando el tenant no ha guardado configuración: claves area1..area8 INTACTAS
 * (las columnas legacy siguen casando), pesos actuales y umbrales 85/70.
 * Conserva `n` e `indicators` para que el serializer emita EXACTAMENTE lo mismo
 * que antes. La meta (goal) se deriva de los indicadores del área.
 */
export const LEGACY_ROLE = Object.freeze({
  key: "terapeuta",
  name: "Equipo terapéutico",
  positions: [],
  isDefault: true,
  thresholds: { ...DEFAULT_THRESHOLDS },
  areas: PERFORMANCE_AREAS.map((a) => ({
    key: a.key,
    n: a.n,
    name: a.name,
    weight: a.weight,
    icon: a.icon,
    goal: a.indicators.map((i) => i.label).join(" · "),
    description: "",
    indicators: a.indicators,
  })),
});

function cleanText(v, max) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

function normalizeThresholds(raw) {
  const green = Math.round(Number(raw?.green));
  const amber = Math.round(Number(raw?.amber));
  if (!Number.isFinite(green) || !Number.isFinite(amber)) return { ...DEFAULT_THRESHOLDS };
  if (!(green <= 100 && green > amber && amber >= 0)) return { ...DEFAULT_THRESHOLDS };
  return { green, amber };
}

function normalizeArea(raw) {
  if (!raw || typeof raw !== "object") return null;
  const key = typeof raw.key === "string" ? raw.key.trim() : "";
  if (!SLUG_RE.test(key)) return null;
  const name = cleanText(raw.name, 120);
  if (!name) return null;
  const weight = Math.round(Number(raw.weight));
  if (!Number.isFinite(weight) || weight < 1 || weight > 100) return null;
  const icon = ALLOWED_ICONS.includes(raw.icon) ? raw.icon : DEFAULT_ICON;
  return {
    key,
    name,
    weight,
    icon,
    goal: cleanText(raw.goal, 300),
    description: cleanText(raw.description, 500),
  };
}

/**
 * Validación defensiva de una lista de roles (venida del cliente o de settings).
 * Reparable se repara (umbrales/iconos inválidos → default; ningún isDefault →
 * el primero); irreparable → null (claves duplicadas o mal formadas, pesos que
 * no suman 100, nº de roles/áreas fuera de rango…).
 *
 * Acepta el array de roles directamente o el objeto canónico `{ roles }`.
 * Devuelve el array normalizado de roles, o null.
 */
export function normalizeRoles(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.roles) ? raw.roles : null;
  if (!list || list.length < 1 || list.length > MAX_ROLES) return null;

  const roleKeys = new Set();
  const roles = [];
  for (const r of list) {
    if (!r || typeof r !== "object") return null;
    const key = typeof r.key === "string" ? r.key.trim() : "";
    if (!SLUG_RE.test(key) || roleKeys.has(key)) return null;
    roleKeys.add(key);
    const name = cleanText(r.name, 120);
    if (!name) return null;

    if (!Array.isArray(r.areas) || r.areas.length < 1 || r.areas.length > MAX_AREAS) return null;
    const areaKeys = new Set();
    const areas = [];
    let weightSum = 0;
    for (const a of r.areas) {
      const area = normalizeArea(a);
      if (!area || areaKeys.has(area.key)) return null;
      areaKeys.add(area.key);
      weightSum += area.weight;
      areas.push(area);
    }
    if (weightSum !== 100) return null;

    const positions = Array.isArray(r.positions)
      ? [...new Set(r.positions.map((p) => cleanText(p, 120)).filter(Boolean))].slice(0, 50)
      : [];

    roles.push({
      key,
      name,
      positions,
      isDefault: r.isDefault === true,
      thresholds: normalizeThresholds(r.thresholds),
      areas,
    });
  }

  // Exactamente UN rol por defecto: si hay varios gana el primero marcado; si
  // no hay ninguno, el primero de la lista.
  const firstDefault = roles.findIndex((r) => r.isDefault);
  const defaultIdx = firstDefault === -1 ? 0 : firstDefault;
  roles.forEach((r, i) => { r.isDefault = i === defaultIdx; });

  return roles;
}

/**
 * Config efectiva de un tenant. Sin nada guardado (o guardado corrupto) →
 * el rol legacy, que reproduce el comportamiento histórico al milímetro.
 */
export function getPerformanceRoles(tenant) {
  const stored = tenant?.settings?.clinica?.performanceRoles;
  const roles = stored == null ? null : normalizeRoles(stored);
  if (!roles) return { roles: [LEGACY_ROLE], isDefaultConfig: true };
  return { roles, isDefaultConfig: false };
}

function normPosition(v) {
  return String(v ?? "").trim().toLowerCase();
}

/** Rol de la config cuyo key coincide, o null. Acepta {roles} o array. */
export function findRoleByKey(rolesConfig, key) {
  const roles = Array.isArray(rolesConfig) ? rolesConfig : rolesConfig?.roles ?? [];
  if (!key) return null;
  return roles.find((r) => r.key === key) ?? null;
}

/** Rol por defecto de la config (siempre hay exactamente uno tras normalizar). */
export function defaultRole(rolesConfig) {
  const roles = Array.isArray(rolesConfig) ? rolesConfig : rolesConfig?.roles ?? [];
  return roles.find((r) => r.isDefault) ?? roles[0] ?? LEGACY_ROLE;
}

/**
 * Rol de desempeño de un miembro del equipo: el primer rol cuyo `positions`
 * contenga su `team_members.position` (comparación case-insensitive y sin
 * espacios sobrantes), o el rol por defecto si nadie lo reclama.
 */
export function resolveRoleForMember(rolesConfig, teamMember) {
  const roles = Array.isArray(rolesConfig) ? rolesConfig : rolesConfig?.roles ?? [];
  const pos = normPosition(teamMember?.position);
  if (pos) {
    for (const r of roles) {
      if ((r.positions ?? []).some((p) => normPosition(p) === pos)) return r;
    }
  }
  return defaultRole(rolesConfig);
}

/**
 * Clave (slug) para un área nueva creada en la UI o propuesta por la IA:
 * minúsculas sin acentos, `_` como separador, única frente a `existentes`.
 * Las claves existentes NUNCA se regeneran al renombrar (son inmutables).
 */
export function slugifyAreaKey(name, existentes = []) {
  const taken = new Set(existentes);
  let base = String(name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // fuera acentos (á→a) antes de slugificar
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  if (!base) base = "area";
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base.slice(0, 64 - String(i).length - 1)}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}
