/**
 * Fuente única de stages aceptados para Lead.stage.
 *
 * `Lead.stage` es STRING(50) en BD, sin ENUM, así que cualquier string cabría.
 * Esta lista whitelisteada se usa en los endpoints (PATCH, import, export)
 * para impedir que entren valores arbitrarios desde el frontend o desde
 * imports masivos.
 *
 * Categorías:
 *   - Estándar (todos los tenants):
 *     new, contacted, qualified, proposal, negotiation, won, lost
 *   - Extendidos (overrides quality-energy y abarcaia, e import histórico):
 *     in_progress, demo_scheduled, demo_done, closed_yes, closed_no
 *   - Extendidos nutrición (override nutri_laura):
 *     consulta_agendada, consulta_realizada, paciente
 *
 * Antes los stages extendidos solo eran aceptados por el endpoint de
 * import; PATCH los descartaba silenciosamente. Ahora hay una sola lista
 * canónica reutilizada por todos los endpoints relevantes.
 *
 * Etiquetas humanas (`STAGE_LABELS`) viven aquí también para que `export`
 * y la UI legacy las consuman desde el mismo punto.
 */

export const ALLOWED_STAGES = [
  // estándar
  "new",
  "contacted",
  "qualified",
  "proposal",
  "negotiation",
  "won",
  "lost",
  // extendidos (QE / abarcaia / import)
  "in_progress",
  "demo_scheduled",
  "demo_done",
  "closed_yes",
  "closed_no",
  // extendidos nutrición (nutri_laura)
  "consulta_agendada",
  "consulta_realizada",
  "paciente",
];

export const STAGE_LABELS = {
  new: "Nuevo",
  contacted: "Contactado",
  qualified: "En seguimiento",
  proposal: "Propuesta",
  negotiation: "Negociación",
  won: "Convertido",
  lost: "Descartado",
  in_progress: "En proceso",
  demo_scheduled: "Demo agendada",
  demo_done: "Demo realizada",
  closed_yes: "Cerrado - Sí",
  closed_no: "Cerrado - No",
  consulta_agendada: "Consulta agendada",
  consulta_realizada: "Consulta realizada",
  paciente: "Paciente activo",
};

export function isValidStage(stage) {
  return ALLOWED_STAGES.includes(stage);
}
