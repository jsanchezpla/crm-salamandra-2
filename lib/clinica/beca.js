/**
 * lib/clinica/beca.js — el informe para la beca (NEAE) y sus nombres oficiales.
 *
 * (Fichero nuevo en /lib, regla #2: la regla la comparten el PDF, el cajón del
 * informe y su prueba. Lo pidió Aumenta el 26/08/2026 — la reina del módulo
 * clínico —, y es del BASE: cualquier centro de este tipo hace estos informes
 * cada curso para la beca del Ministerio.)
 *
 * ── LA REGLA, QUE ES DE LA CONVOCATORIA Y NO NUESTRA ───────────────────────
 * La beca de apoyo educativo no habla de «logopedia» ni de «psicología»: sus
 * conceptos son «Reeducación del lenguaje» y «Reeducación pedagógica y
 * habilidades sociales». El informe que la familia presenta tiene que llevar
 * ESOS nombres en la cabecera, no los del centro:
 *
 *   logopedia                                → Reeducación del lenguaje
 *   psicología / terapia ocupacional /
 *   pedagogía                                → Reeducación pedagógica y
 *                                              habilidades sociales
 *
 * Solo se mapean las especialidades que la convocatoria cubre: una que no está
 * en la tabla (nutrición, fisioterapia…) NO sale en la cabecera del informe de
 * beca — inventarle un nombre oficial sería peor que omitirla.
 *
 * ── QUÉ LLEVA EL INFORME ───────────────────────────────────────────────────
 * Solo tres apartados (motivo de consulta, objetivos y metodología) y la firma
 * del terapeuta. El resto de secciones del informe clínico NO se imprimen en
 * este tipo aunque estén escritas: la beca pide lo que pide.
 */

// specialty key (lib/clinica/specialties.js) → denominación oficial de la beca.
const DENOMINACION_BECA = {
  logopedia: "Reeducación del lenguaje",
  psicologia: "Reeducación pedagógica y habilidades sociales",
  terapia_ocupacional: "Reeducación pedagógica y habilidades sociales",
  pedagogia: "Reeducación pedagógica y habilidades sociales",
};

/**
 * Denominaciones oficiales (únicas, en orden estable) para las especialidades
 * de un paciente. Devuelve [] si ninguna está cubierta por la convocatoria.
 */
export function denominacionesBeca(specialties) {
  const out = [];
  for (const key of Array.isArray(specialties) ? specialties : []) {
    const d = DENOMINACION_BECA[key];
    if (d && !out.includes(d)) out.push(d);
  }
  return out;
}

/**
 * Los apartados del informe de beca, en su orden de lectura. `motiveOfIntervention`
 * se REUTILIZA como «Motivo de consulta» (mismo dato, el rótulo de la beca);
 * `methodology` es nuevo y solo lo usa este tipo (vive en contentSections, que
 * es JSONB: no pide migración).
 */
export const SECCIONES_BECA = [
  { key: "motiveOfIntervention", label: "Motivo de consulta", lista: false },
  { key: "objectives", label: "Objetivos", lista: true },
  { key: "methodology", label: "Metodología", lista: false },
];

/** ¿Es este informe del tipo beca? Un solo sitio para preguntar. */
export function esInformeBeca(reportType) {
  return reportType === "beca";
}
