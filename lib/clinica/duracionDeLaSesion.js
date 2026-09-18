/**
 * lib/clinica/duracionDeLaSesion.js — cuánto duró una sesión, y de dónde se
 * sabe (18/09/2026, Aumenta: «aparece duración 45 min en la ficha de paciente
 * cuando la mayoría de sus sesiones son de 60 min»).
 *
 * (Fichero nuevo en /lib, regla #2. El motivo: la duración de una sesión es
 * un «si no lo sé, no me lo invento» con dos fuentes —lo que escribe la
 * terapeuta y lo que ya sabe la cita— y hasta hoy no vivía en ningún sitio:
 * el POST copiaba el cuerpo y punto. Suelto dentro de la ruta no se puede
 * probar, y es justo la regla que se saltó el volcado.)
 *
 * ── DE DÓNDE VIENE, MEDIDO EN PRODUCCIÓN EL 18/09/2026 ──────────────────────
 * Olga avisó de que la ficha de sus pacientes decía «45 min» en sesiones que
 * duran una hora. No era un default del CRM ni la duración del tipo de cita:
 * el volcado de Organízate (`scripts/_hechos/import-aumenta-sesiones.js`)
 * escribió `duration: 45` A FUEGO en las 22.996 sesiones que trajo, porque
 * Organízate no guarda la duración de la sesión. En la base:
 *
 *   · 22.996 sesiones a 45 min — TODAS del volcado, hasta el 31/07/2026, y
 *     ninguna otra sesión del centro dice 45;
 *   ·    695 a null y 71 con su duración de verdad (60 y 90), ya del CRM.
 *
 * O sea: el 45 no era un dato, era un relleno. Y salía por dos sitios —la
 * ficha del paciente y el PDF del registro (`sessionPdf.js`), que se manda
 * fuera del centro—, así que el CRM estaba afirmando por escrito algo que
 * nadie midió. `scripts/vaciar-duracion-sesiones-volcadas.js` lo vació.
 *
 * ── LA REGLA, ENTONCES ──────────────────────────────────────────────────────
 *   1. Lo que escribe la terapeuta, si es un número de minutos con sentido.
 *      Es la única que estuvo allí.
 *   2. Si no lo escribe y la sesión sale de una CITA, la de la cita. La cita
 *      lo sabe —es una foto de su tipo al reservarla— y hasta hoy se tiraba:
 *      las 500 sesiones enganchadas a una cita tenían duración null mientras
 *      su cita decía 45 o 60. Es el mismo criterio que `clientId`, que ya se
 *      copia del paciente al crear la sesión.
 *   3. Y si no hay ni lo uno ni lo otro, **null**. Nunca un número por
 *      defecto: la ficha ya pinta «— min» y el PDF se salta la línea, que es
 *      exactamente lo que hay que decir cuando no se sabe.
 *
 * El tope de 480 es el de `Booking`/`EventType`: una sesión de ocho horas no
 * existe, y un 100000 pegado en el cuerpo no tiene por qué llegar a la tabla.
 */

/** Minutos válidos de una sesión: entero, de 1 a 480. Si no, null. */
export function minutosDeSesion(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1 || n > 480) return null;
  return n;
}

/**
 * Cuánto dura esta sesión: lo pedido, si no lo de su cita, si no null.
 *
 * @param pedida  lo que manda el formulario (puede venir "", null o basura)
 * @param cita    la cita de la que sale el registro, o null. Se lee su
 *                `duration`; un objeto sin ella cuenta como no tenerla.
 * @returns minutos (1..480) o `null` si no se sabe
 */
export function duracionDeLaSesion({ pedida = null, cita = null } = {}) {
  const escrita = minutosDeSesion(pedida);
  if (escrita !== null) return escrita;
  return minutosDeSesion(cita?.duration ?? null);
}
