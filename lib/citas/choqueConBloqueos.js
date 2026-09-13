/**
 * lib/citas/choqueConBloqueos.js — qué bloqueos de la agenda pisa una cita, y
 * los bloqueos como OCUPACIÓN para el generador de huecos (13/09/2026).
 *
 * (Fichero nuevo en /lib, regla #2: lo necesitan a la vez el generador de
 * «Proponer 3 horarios» —`lib/citas/suggestSlots.js`— y su re-validación en
 * `app/api/citas/bookings/[id]/suggest-slots/route.js`. Si cada uno hiciera su
 * cuenta, el generador descartaría un bloqueo que la re-validación dejaría
 * pasar, o al revés.)
 *
 * ── EL FALLO QUE ARREGLA ────────────────────────────────────────────────────
 * «Proponer 3 horarios» solo descontaba festivos y citas: no leía
 * `team_blocks`. En nutri_laura, 7 de 143 candidatos caían dentro de un
 * bloqueo de la profesional, y 1 de las 3 tarjetas. El alta manual sí avisa de
 * esos bloqueos (409 `permitirBloqueo`, AV-0092): la sugerencia proponía algo
 * que el alta habría puesto en duda.
 *
 * ── POR QUÉ OCUPACIÓN Y NO `restarAusencias` ────────────────────────────────
 * `restarAusencias` (lib/citas/ausencias.js) PARTE el tramo del horario: con un
 * horario de 15:00 a 19:00 y un bloqueo de 15:30 a 15:45 quedarían dos tramos
 * (15:00-15:30 y 15:45-19:00), y la rejilla del segundo arrancaría a las 15:45
 * —15:45, 16:45, 17:45—: la agenda entera se correría un cuarto de hora por un
 * bloqueo de un cuarto de hora. Tratando el bloqueo como una cita más, la
 * rejilla no se mueve: solo desaparece el hueco de las 15:00, que es lo que
 * pisa. Es el mismo criterio con el que avisa el alta manual (solape del tramo
 * de la cita con el del bloqueo), así que no se propone nada que el alta
 * pondría en duda. El widget público sigue con `restarAusencias`, a propósito
 * (esto no lo toca): el mismo día pueden salir horas distintas por las dos vías.
 *
 * Lo que NO hace (queda para después): mover una cita —arrastrar, «Cambiar
 * hora», «Elegir esta»— sigue sin avisar de los bloqueos. En Aumenta hay cientos
 * de citas encima de bloqueos «libre pacientes» y avisar al moverlas es una
 * decisión de producto, no un arreglo.
 *
 * ── A QUIÉN AFECTA CADA BLOQUEO ─────────────────────────────────────────────
 * Mismo criterio que `cargarAusencias`: un bloqueo SIN `teamMemberId` es del
 * centro y tapa a todo el mundo; uno CON persona, solo a esa persona. Una cita
 * sin profesional solo choca con los del centro.
 *
 * ── SIN IMPORTS, A PROPÓSITO ────────────────────────────────────────────────
 * Lógica pura sobre instantes (Date o ISO), sin zona horaria: un bloqueo que
 * cruza la medianoche o el cambio de hora choca igual. Y sin imports para que
 * la pueda leer también el navegador el día que mover una cita avise de los
 * bloqueos (precedente: `preguntaDeSerie.js`, que explica por qué `slots.js`
 * arrastraría el ORM al bundle).
 */

/** Instante en milisegundos, o `null` si no se puede leer. */
const ms = (valor) => {
  if (valor == null) return null;
  const t = new Date(valor).getTime();
  return Number.isNaN(t) ? null : t;
};

/**
 * Los bloqueos que aplican a una persona: los del centro siempre, los suyos si
 * tiene persona. Con `profesionalId` null, solo los del centro.
 */
export function bloqueosQueAplican(bloqueos, profesionalId = null) {
  return (bloqueos ?? []).filter(
    (b) => b && (b.teamMemberId == null || (profesionalId != null && b.teamMemberId === profesionalId)),
  );
}

/**
 * Los bloqueos que pisa una cita [inicio, inicio + duracion) — intervalo
 * semiabierto: una cita de 10:00 a 11:00 NO choca con un bloqueo que empieza a
 * las 11:00. Devuelve `[]` si la cita no se puede leer (fecha ilegible o
 * duración ≤ 0) y descarta los bloqueos ilegibles o con el fin antes del inicio.
 *
 * @param bloqueos  filas { id, teamMemberId, startAt, endAt, label }
 * @param cita      { inicio, duracion (minutos), profesionalId }
 */
export function bloqueosQueChocan(bloqueos, { inicio, duracion, profesionalId = null } = {}) {
  const a = ms(inicio);
  const d = Number(duracion);
  if (a == null || !(d > 0)) return [];
  const z = a + d * 60000;
  return bloqueosQueAplican(bloqueos, profesionalId).filter((b) => {
    const s = ms(b.startAt);
    const e = ms(b.endAt);
    return s != null && e != null && e > s && s < z && e > a;
  });
}

/**
 * Cada bloqueo que aplica a la persona, con la forma de una cita que ocupa su
 * tramo — `{ scheduledAt: Date, duration: minutos }` —, para dárselo a
 * `generateSlotsForDay` junto a las citas de verdad (ver la cabecera: ocupación,
 * no resta).
 */
export function bloqueosComoOcupacion(bloqueos, profesionalId = null) {
  return bloqueosQueAplican(bloqueos, profesionalId).flatMap((b) => {
    const s = ms(b.startAt);
    const e = ms(b.endAt);
    return s != null && e != null && e > s ? [{ scheduledAt: new Date(s), duration: (e - s) / 60000 }] : [];
  });
}
