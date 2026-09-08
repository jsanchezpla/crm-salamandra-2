/**
 * lib/citas/nombreEnLaAgenda.js — qué nombre lleva una cita en la rejilla
 * (08/09/2026, AV-0088 de Aumenta).
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 * Laura: «al generar nuevas citas nos sale en horario el nombre de la madre en
 * lugar del nombre del paciente».
 *
 * La agenda pintaba `bookings.client_name`, que es el nombre del TITULAR de la
 * ficha de familia. En un centro donde el cliente es quien paga y el paciente
 * es el niño, eso es el nombre de la madre.
 *
 * Y no se notó hasta ahora por dos cosas que se juntaron: las 13.117 citas
 * importadas de Organízate traen al NIÑO escrito en `client_name`, así que las
 * viejas decían el paciente; y desde el 07/09/2026, con el alta por paciente,
 * el formulario pide explícitamente «Padre, madre o tutor que abre la ficha»
 * como titular, así que las fichas nuevas llevan ahí a la madre — y al elegir
 * la ficha en una cita, `datosAlElegirFicha` copia ese nombre encima.
 *
 * O sea: lo arreglamos ayer por un lado y salió por el otro.
 *
 * ── LA REGLA ───────────────────────────────────────────────────────────────
 * En la rejilla manda el PACIENTE cuando la cita tiene uno. Es lo que una
 * terapeuta necesita leer de un vistazo: a quién ve a las cinco, no quién paga.
 * Sin paciente —una consulta de adulto, un taller, un centro sin el módulo de
 * pacientes— se queda el nombre de siempre y no cambia nada.
 *
 * El dato nunca estuvo mal: la cita SIEMPRE llevó su `patient_id` correcto. Lo
 * que fallaba era la etiqueta, y el endpoint del calendario ni siquiera
 * consultaba la tabla de pacientes para poder ponerla.
 */

/** Un nombre y unos apellidos en una sola línea, o «» si no hay nada. */
function nombreCompleto(persona) {
  return `${persona?.firstName ?? ""} ${persona?.lastName ?? ""}`.replace(/\s+/g, " ").trim();
}

/**
 * El nombre que va en la caja de la cita.
 *
 * @param {object} cita  con `patient` (si se ha cargado) y `clientName`
 * @returns {string}
 */
export function nombreDeLaCita(cita) {
  const paciente = nombreCompleto(cita?.patient);
  if (paciente) return paciente;
  const familia = typeof cita?.clientName === "string" ? cita.clientName.trim() : "";
  return familia;
}
