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
  // extendidos BOOKING (módulo `booking`, 24/08/2026)
  //
  // Un embudo de contratación musical no cabe en las cinco estándar, y forzarlo
  // pierde justo lo que hay que mirar. Dos decisiones dentro:
  //
  //  · `respuesta_recibida` existe porque en booking el SILENCIO es la respuesta
  //    más común y no es un «no». Sin esta etapa, «me han contestado» y «no me
  //    han contestado» acaban los dos en `contacted`, y entonces no se puede
  //    saber a quién hay que insistir. Un «no» explícito va a `lost`.
  //  · `fecha_confirmada` es el GANADO de este embudo, no `won`: lo que se cierra
  //    es una fecha concreta, y `actuacion_realizada` es lo que viene DESPUÉS de
  //    ganar (ya se tocó), no otra forma de ganar. Las dos cuentan como ganadas
  //    en `embudos.js`, o el día del concierto la conversión bajaría.
  "propuesta_enviada",
  "respuesta_recibida",
  "negociando_cache",
  "fecha_confirmada",
  "actuacion_realizada",
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
  // Booking. Los rótulos son los que usa quien contrata bolos, no los del CRM:
  // «Han respondido» y no «Cualificado», «Fecha cerrada» y no «Ganado».
  propuesta_enviada: "Propuesta enviada",
  respuesta_recibida: "Han respondido",
  negociando_cache: "Negociando caché",
  fecha_confirmada: "Fecha cerrada",
  actuacion_realizada: "Actuación realizada",
};

export function isValidStage(stage) {
  return ALLOWED_STAGES.includes(stage);
}
