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
