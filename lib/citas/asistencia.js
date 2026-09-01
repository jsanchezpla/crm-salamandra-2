/**
 * lib/citas/asistencia.js — una cita que ya terminó y que nadie marcó SE DA
 * POR ASISTIDA (01/09/2026, Rodrigo).
 *
 * ── EL ENCARGO ──────────────────────────────────────────────────────────────
 * «Si pasa una cita y no se marca si ha asistido, que el CRM asuma que ha
 * asistido hasta que se indique lo contrario.»
 *
 * ── POR QUÉ HACÍA FALTA ─────────────────────────────────────────────────────
 * Marcar la asistencia es un botón más al final del día, y un botón que hay que
 * acordarse de pulsar 12.000 veces al año no se pulsa. El resultado es que en
 * Aumenta casi toda la agenda pasada se queda en `confirmed` para siempre, y
 * las estadísticas del centro cuentan como «atendidas» solo las poquísimas que
 * alguien tocó: el porcentaje de asistencia salía ridículo y la tasa de
 * ausencias, inflada (`tasaAusenciasPct` se mide contra atendidas + faltas).
 *
 * La verdad de una consulta es la contraria: **lo normal es que la gente vaya**.
 * La falta es la excepción, y la excepción SÍ se apunta, porque tiene
 * consecuencias (se avisa a la familia, se justifica, se recupera —
 * `recuperacionFalta.js`). Así que el estado que hay que teclear es el raro, y
 * el corriente se presume.
 *
 * ── NO SE ESCRIBE NADA EN LA BASE ───────────────────────────────────────────
 * Esto es una PRESUNCIÓN al leer, no un cambio de estado. Ninguna de las 12.030
 * citas de Aumenta se reescribe, no hay tarea nocturna que las toque y no hay
 * migración: `bookings.status` sigue diciendo `confirmed`. Se decidió así por
 * tres motivos:
 *
 *   1. «Hasta que se indique lo contrario» es reversible por definición. Marcar
 *      «No asistió» sigue funcionando igual el día 1 que el día 400, porque la
 *      fila nunca se movió de sitio.
 *   2. Un trabajo que reescribe miles de filas de golpe se equivoca una vez y
 *      no se sabe qué había antes. Aquí, si mañana Rodrigo dice que la
 *      presunción no le gusta, se quita este fichero y todo vuelve solo.
 *   3. `completed` de verdad significa «alguien lo comprobó». Fundir las dos
 *      cosas en la columna perdería para siempre la diferencia entre lo
 *      comprobado y lo supuesto, que es justo lo que `esPresunta` conserva.
 *
 * ── QUÉ NO ENTRA ────────────────────────────────────────────────────────────
 * Solo se presume sobre `confirmed`. Una cita `pending` es una petición que el
 * centro **todavía no ha aceptado** (lista de espera, reserva pública sin
 * confirmar): que pase su hora no significa que la persona viniera, significa
 * que nadie le dijo que sí. `cancelled` y `no_show` son decisiones tomadas y no
 * se tocan nunca.
 *
 * Y se presume cuando la cita ha TERMINADO, no cuando ha empezado: a las 10:15
 * de una cita de 10:00 a 11:00 todavía se está dentro.
 */

/** Los estados que ya dicen algo: la presunción no se mete con ellos. */
const ESTADOS_DECIDIDOS = new Set(["completed", "cancelled", "no_show"]);

/** Duración de repuesto cuando la cita no la trae (minutos). */
const DURACION_POR_DEFECTO = 60;

/**
 * A qué hora acaba una cita. `duration` va en minutos y se fotografía al
 * crearla, así que no depende del tipo de cita de hoy.
 *
 * @returns {Date|null} `null` si la cita no tiene ni fecha.
 */
export function finDeLaCita(cita) {
  const inicio = cita?.scheduledAt ? new Date(cita.scheduledAt) : null;
  if (!inicio || Number.isNaN(inicio.getTime())) return null;
  const minutos = Number(cita?.duration);
  const dura = Number.isFinite(minutos) && minutos > 0 ? minutos : DURACION_POR_DEFECTO;
  return new Date(inicio.getTime() + dura * 60_000);
}

/** ¿Ha terminado ya? (medio-abierto: justo al minuto de acabar, sí). */
export function yaTermino(cita, ahora = new Date()) {
  const fin = finDeLaCita(cita);
  return fin ? fin.getTime() <= new Date(ahora).getTime() : false;
}

/**
 * ¿Esta cita se está dando por asistida sin que nadie lo haya dicho?
 *
 * Es lo que separa «lo comprobó una persona» de «lo supone el programa», y por
 * eso la ficha de la cita lo cuenta en una línea en vez de mentir con un
 * «Completada» a secas.
 */
export function esPresunta(cita, ahora = new Date()) {
  return cita?.status === "confirmed" && yaTermino(cita, ahora);
}

/**
 * El estado con el que hay que TRATAR la cita: el suyo, o `completed` si es una
 * confirmada que ya pasó.
 *
 * Devuelve siempre uno de los cinco estados de `bookings.status`, para que
 * quien lo llame pueda seguir comparando como comparaba.
 */
export function estadoEfectivo(cita, ahora = new Date()) {
  const status = cita?.status ?? "pending";
  if (ESTADOS_DECIDIDOS.has(status) || status !== "confirmed") return status;
  return yaTermino(cita, ahora) ? "completed" : status;
}

/** ¿Cuenta como atendida? (lo comprobado y lo presumido, juntos). */
export function cuentaComoAtendida(cita, ahora = new Date()) {
  return estadoEfectivo(cita, ahora) === "completed";
}
