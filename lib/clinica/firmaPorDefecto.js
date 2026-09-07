/**
 * lib/clinica/firmaPorDefecto.js — quién firma un registro de sesión NUEVO si
 * nadie toca el desplegable (07/09/2026, AV-0060 de Aumenta).
 *
 * Daniela: «que salga la persona correcta cuando hacemos un registro de
 * sesión, de manera automática, que no tengamos que modificarlo». Hasta hoy el
 * editor ponía al profesional de la cita (`?prof=`) y, si no venía —el
 * registro abierto desde la ficha del paciente—, al terapeuta DE REFERENCIA
 * del paciente (`mainTherapistId`), que en un paciente compartido es «el
 * primero de la lista» (`lib/clinica/terapeutas.js`): la logopeda escribía y
 * el registro salía firmado por la psicóloga. Quien está escribiendo no
 * entraba nunca en la cuenta.
 *
 * La regla, en orden:
 *   1. el profesional de la cita desde la que se abre el registro, si es del
 *      equipo (quien dio la sesión es quien la registra, y la cita lo sabe);
 *   2. quien está escribiendo, si tiene ficha de equipo (`/api/team/me`);
 *   3. el terapeuta de referencia del paciente;
 *   4. nadie: que lo elija.
 *
 * Pura: recibe ids y una lista, devuelve un id o "". La prueba está en
 * `scripts/_smoke-firma-por-defecto.mjs`.
 */
export function terapeutaPorDefecto({ profDeLaCita = null, yo = null, equipo = null, mainTherapistId = null } = {}) {
  const lista = Array.isArray(equipo) ? equipo : null;
  const esDelEquipo = (id) => !id || !lista || lista.some((m) => m?.id === id);
  if (profDeLaCita && lista && lista.length && esDelEquipo(profDeLaCita)) return profDeLaCita;
  if (yo) return yo;
  if (mainTherapistId) return mainTherapistId;
  return "";
}
