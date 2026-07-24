/**
 * Especialidades clínicas — taxonomía COMPARTIDA entre:
 *   · Pacientes  → para dividirlos por servicio (Patient.specialties).
 *   · Equipo     → el rol/especialidad de cada profesional (TeamMember.specialties).
 *
 * Notas:
 *   - "Diagnóstico y evaluación" es UNA sola especialidad (nombre compuesto).
 *   - Nutrición vive aquí junto a las de terapia porque un mismo centro puede
 *     ofrecer ambos servicios (el escaparate `demo` los tiene).
 *   - Tanto pacientes como profesionales pueden tener VARIAS (array).
 */

export const SPECIALTIES = [
  { key: "nutricion", label: "Nutrición" },
  { key: "logopedia", label: "Logopedia" },
  { key: "terapia_ocupacional", label: "Terapia ocupacional" },
  { key: "psicologia", label: "Psicología" },
  { key: "neuropsicologia", label: "Neuropsicología" },
  // Pedagogía: añadida 2026-07-24 al incorporar el equipo real de Aumenta
  // (tiene pedagogas en plantilla). Como el resto, aplica a pacientes y equipo.
  { key: "pedagogia", label: "Pedagogía" },
  { key: "fisioterapia", label: "Fisioterapia" },
  { key: "rehabilitacion", label: "Rehabilitación" },
  { key: "atencion_temprana", label: "Atención temprana" },
  { key: "diagnostico_evaluacion", label: "Diagnóstico y evaluación" },
];

export const SPECIALTY_KEYS = SPECIALTIES.map((s) => s.key);
export const SPECIALTY_LABEL = Object.fromEntries(SPECIALTIES.map((s) => [s.key, s.label]));

/**
 * Normaliza una entrada a claves válidas, sin duplicados y en el ORDEN canónico
 * (para que el mismo conjunto se guarde siempre igual). Ignora lo desconocido.
 */
export function normalizeSpecialties(input) {
  if (!Array.isArray(input)) return [];
  const set = new Set(input.filter((k) => typeof k === "string" && SPECIALTY_KEYS.includes(k)));
  return SPECIALTY_KEYS.filter((k) => set.has(k));
}

/** Etiquetas legibles de un array de claves (en orden canónico). */
export function specialtyLabels(input) {
  return normalizeSpecialties(input).map((k) => SPECIALTY_LABEL[k]);
}

/**
 * Módulo asistencial derivado (compat con Patient.careType, que se desplegó
 * antes que esta taxonomía): 'nutricion' si la ÚNICA especialidad es nutrición;
 * 'terapia' si hay alguna de terapia; null si no hay ninguna.
 */
export function deriveCareType(specialties) {
  const norm = normalizeSpecialties(specialties);
  if (norm.length === 0) return null;
  if (norm.length === 1 && norm[0] === "nutricion") return "nutricion";
  return "terapia";
}
