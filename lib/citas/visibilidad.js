/**
 * lib/citas/visibilidad.js — ¿quién ve las citas de quién?
 *
 * (Fichero nuevo en /lib, regla #2: la decisión la comparten el listado, el
 * calendario y la ficha de una cita, y estaba copiada en los tres.)
 *
 * REGLA POR DEFECTO (la de siempre): un profesional NO admin solo ve SUS
 * citas. No es cosmética — se puso a propósito porque el listado y la lista de
 * espera enseñan nombre, email y teléfono del paciente, y sin el filtro
 * cualquier miembro del equipo veía los datos personales de toda la agenda.
 *
 * AGENDA COMPARTIDA (`settings.citas.agendaCompartida: true`): todo el equipo
 * ve las citas de todo el equipo. Lo pidió Aumenta en la reunión del 28/07 —
 * es un centro donde las terapeutas se cubren entre sí y necesitan ver la
 * agenda completa para cuadrar recuperaciones.
 *
 * Va POR TENANT y apagada por defecto: es una decisión de cada cliente sobre
 * los datos de SUS pacientes, no algo que el CRM deba dar por supuesto. Un
 * centro con varias sedes o con profesionales externos querrá lo contrario.
 */

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/** ¿Este tenant comparte la agenda con todo el equipo? (default: no) */
export function agendaCompartida(tenant) {
  return tenant?.settings?.citas?.agendaCompartida === true;
}

/**
 * ¿Puede este usuario ver TODAS las citas del tenant?
 * Admin siempre; el resto, solo si el tenant comparte agenda.
 */
export function veTodaLaAgenda({ tenant, role }) {
  if (ADMIN_ROLES.has(role)) return true;
  return agendaCompartida(tenant);
}
