/**
 * Especialidades de DERIVACIÓN (sprint Aumenta 2026-07-28): a qué profesional
 * externo se deriva a un paciente en un informe de tipo "Derivación".
 *
 * NO confundir con lib/clinica/specialties.js (las líneas de servicio del
 * propio centro): esto son especialistas EXTERNOS. Lista cerrada definida por
 * Aumenta en la reunión del 28/07/2026.
 */

export const REFERRAL_SPECIALTIES = [
  { key: "otorrinolaringologia", label: "Otorrinolaringología" },
  { key: "salud_mental", label: "Salud mental" },
  { key: "neuropediatria", label: "Neuropediatra" },
  { key: "neurologia", label: "Neurólogo" },
  { key: "fisioterapia", label: "Fisioterapia" },
  { key: "nutricion", label: "Nutricionista" },
  { key: "orientacion_eoep", label: "Equipo de orientación (EOEP)" },
  { key: "psiquiatria", label: "Psiquiatra" },
  { key: "traumatologia", label: "Traumatólogo" },
  { key: "pediatria", label: "Pediatra" },
  { key: "medico_cabecera", label: "Médico de cabecera" },
];

export const REFERRAL_SPECIALTY_LABEL = Object.fromEntries(
  REFERRAL_SPECIALTIES.map((s) => [s.key, s.label])
);

const VALID_KEYS = new Set(REFERRAL_SPECIALTIES.map((s) => s.key));

export function isReferralSpecialty(key) {
  return VALID_KEYS.has(key);
}

/**
 * Catálogo EFECTIVO de un tenant (sprint Aumenta 2026-07, punto 3.1).
 *
 * La lista de arriba es el punto de partida —la que dio Aumenta—, pero cada
 * centro deriva a los suyos: `settings.clinica.referralSpecialties` la
 * sustituye. Se guarda como [{ key, label }] y no como texto suelto porque los
 * informes ya guardados apuntan a la CLAVE: renombrar la etiqueta no puede
 * dejar huérfano un informe firmado.
 */
export function referralSpecialtiesOf(tenant) {
  const propias = tenant?.settings?.clinica?.referralSpecialties;
  if (!Array.isArray(propias) || propias.length === 0) return REFERRAL_SPECIALTIES;
  return propias
    .filter((s) => s && typeof s === "object" && s.key && s.label)
    .map((s) => ({ key: String(s.key), label: String(s.label) }));
}

export function referralSpecialtyLabelOf(tenant, key) {
  if (!key) return null;
  const encontrada = referralSpecialtiesOf(tenant).find((s) => s.key === key);
  // Si la clave ya no está en el catálogo (la quitaron después), se enseña la
  // etiqueta original antes que un código feo: el informe viejo sigue leyéndose.
  return encontrada?.label ?? REFERRAL_SPECIALTY_LABEL[key] ?? key;
}

export function isReferralSpecialtyOf(tenant, key) {
  return referralSpecialtiesOf(tenant).some((s) => s.key === key);
}

/** Clave estable a partir de una etiqueta escrita a mano ("Logopeda" → "logopeda"). */
export function slugEspecialidad(label) {
  return String(label ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}
