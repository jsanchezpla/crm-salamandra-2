/**
 * lib/citas/duracionBloqueo.js — que un hueco cerrado no se coma el curso
 * entero sin que nadie lo haya querido (08/09/2026).
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 * Daniela: «sigo sin tener horario en CRM actualizado… no coincide». Su agenda
 * del CRM sí coincidía con Organízate hasta el viernes 11; a partir de ahí
 * tenía encima UN bloqueo de 420.495 minutos —del 11/09/2026 a las 15:30 al
 * 30/06/2027 a las 15:45— que tapaba 991 citas vivas. Estefanía tenía otro
 * igual, etiquetado «Vacaciones», encima de 1.163 citas.
 *
 * Los dos llevan la misma huella: la HORA de fin es la de inicio más quince
 * minutos, y la FECHA de fin es el último día del curso. O sea, alguien
 * entendió «hasta cuándo» como «hasta cuándo se repite» y no como «cuándo
 * termina este hueco». No es cosa de una persona despistada: son dos personas
 * distintas, dos días distintos y la misma equivocación, y Daniela lo intentó
 * SEIS veces en ocho minutos. Eso es la pantalla, no ellas.
 *
 * ── POR QUÉ NO SE PROHÍBE Y SE PREGUNTA ────────────────────────────────────
 * Un bloqueo largo de verdad existe: unas vacaciones de tres semanas son un
 * bloqueo de tres semanas. Prohibir por encima de un día rompería el caso
 * legítimo. Lo que no puede pasar es que salga sin querer y en silencio, así
 * que por encima de 24 h hace falta decir que sí a propósito
 * (`confirmarLargo`), y el aviso NOMBRA la equivocación probable cuando lleva
 * la huella de arriba.
 *
 * Vive en `lib/` y no en el endpoint porque la pantalla necesita el MISMO
 * cálculo para preguntar antes de mandar: si cada lado lo hiciera por su
 * cuenta, un día dirían cosas distintas.
 */

/** Minutos que tiene un día. Por encima de esto, un bloqueo hay que quererlo. */
export const MINUTOS_DE_UN_DIA = 24 * 60;

/** Los minutos que dura, o null si las fechas no valen. */
export function minutosDeBloqueo(inicio, fin) {
  const a = inicio instanceof Date ? inicio : new Date(inicio);
  const b = fin instanceof Date ? fin : new Date(fin);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const min = (b.getTime() - a.getTime()) / 60000;
  return Number.isFinite(min) ? min : null;
}

/** 'HH:MM' de un instante en hora de Madrid, que es la que se teclea. */
function horaMadrid(d) {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}

/**
 * ¿Hay que preguntar antes de guardar este bloqueo? Devuelve null cuando no
 * (lo normal), y si sí, con qué palabras se pregunta.
 *
 * `mismaHoraDelDia` es la huella del fallo: se acaba a la misma hora a la que
 * empieza (o casi), pero días o meses después. Cuando aparece, el aviso deja de
 * ser un «son muchos días» genérico y dice lo que de verdad ha pasado.
 */
export function avisoDeBloqueoLargo(inicio, fin) {
  const minutos = minutosDeBloqueo(inicio, fin);
  if (minutos === null || minutos <= MINUTOS_DE_UN_DIA) return null;

  const a = inicio instanceof Date ? inicio : new Date(inicio);
  const b = fin instanceof Date ? fin : new Date(fin);
  const dias = Math.round(minutos / MINUTOS_DE_UN_DIA);
  const [hi, mi] = horaMadrid(a).split(":").map(Number);
  const [hf, mf] = horaMadrid(b).split(":").map(Number);
  const distancia = Math.abs(hf * 60 + mf - (hi * 60 + mi));
  const mismaHoraDelDia = distancia <= 60;

  const cuanto = dias >= 60 ? `${Math.round(dias / 30)} meses` : `${dias} días`;
  const texto = mismaHoraDelDia
    ? `Esto cierra la agenda ${cuanto} seguidos, no ese rato de cada día. Si lo que quieres es guardar la misma hora todas las semanas, hay que apuntar el hueco de cada día: «hasta cuándo» es cuándo termina ESTE hueco, no hasta cuándo se repite.`
    : `Esto cierra la agenda ${cuanto} seguidos. Si son vacaciones o una baja, adelante; si no, revisa la fecha de fin.`;

  return { minutos, dias, mismaHoraDelDia, texto };
}

/**
 * ── LA DURACIÓN QUE SE PROPONE AL PULSAR UN HUECO (18/09/2026) ──────────────
 *
 * Sale de AV-0200 (Rocío, la colaboradora de Laura): preguntaba si un bloqueo
 * podía durar 50 minutos. Puede —la duración es la hora de fin, un campo
 * libre—, pero al pulsar un hueco del calendario el formulario proponía
 * SIEMPRE una hora y había que corregirla cada vez.
 *
 * ── POR QUÉ NO SE MIRAN LOS TIPOS DE CITA LOS PRIMEROS ──────────────────────
 * La idea obvia —«proponer lo que dura una cita en ese centro»— no arregla el
 * caso que la originó. Medido en producción el 18/09/2026: los tipos de cita
 * de `nutri_laura` son cuatro de 60 minutos y uno de 30, así que seguiría
 * proponiendo 60. Lo que sí distingue a cada persona es lo que BLOQUEA de
 * verdad: los cuatro bloqueos cortos de Rocío son de 45 minutos, y en
 * `aumenta` conviven 3.830 bloqueos de 60 con 3.380 de 15 — dos costumbres
 * distintas dentro del mismo centro, que una sola cifra del centro no puede
 * servir a las dos.
 *
 * De ahí el orden: lo que bloquea QUIEN MIRA, luego lo que bloquea el centro,
 * y solo si no hay nada de eso, sus tipos de cita (la duración más corta: un
 * bloqueo que se queda corto se alarga de un tirón, uno que se pasa tapa
 * huecos que nadie quiso cerrar). Y si tampoco hay tipos, la hora de siempre.
 *
 * Es una propuesta, no una regla: el campo se sigue pudiendo escribir. Con el
 * sesgo sabido —quien lleva meses aceptando los 60 que proponía la pantalla
 * seguirá viendo 60— porque corregirlo sería adivinar lo que quiso hacer.
 */
export const DURACION_POR_DEFECTO = 60;

/**
 * Por encima de esto, un bloqueo ya no es ejemplo de «ese rato».
 *
 * Son cuatro horas: media jornada, unas vacaciones o el día entero (que se
 * escribe 00:00–23:59, o sea 1.439 minutos y no 1.440 — en `nutri_laura` hay
 * seis así, y sin este corte serían la costumbre de la casa). Eso no se apunta
 * pulsando un hueco de la rejilla, se apunta en Citas → Bloqueos.
 */
const TOPE_DE_EJEMPLO = 4 * 60;

/** Minutos de un bloqueo que sirven de ejemplo: cortos, positivos y enteros. */
function minutosUtiles(bloqueos) {
  const out = [];
  for (const b of bloqueos ?? []) {
    const min = minutosDeBloqueo(b?.startAt ?? b?.start_at, b?.endAt ?? b?.end_at);
    if (min === null || min <= 0 || min > TOPE_DE_EJEMPLO) continue;
    out.push(Math.round(min));
  }
  return out;
}

/** La duración que más se repite; a igualdad, la más corta. `null` si no hay. */
function masRepetida(minutos) {
  if (!minutos.length) return null;
  const cuenta = new Map();
  for (const m of minutos) cuenta.set(m, (cuenta.get(m) ?? 0) + 1);
  let mejor = null;
  for (const [min, veces] of cuenta) {
    if (mejor === null || veces > mejor.veces || (veces === mejor.veces && min < mejor.min)) {
      mejor = { min, veces };
    }
  }
  return mejor.min;
}

/**
 * Cuántos minutos proponer, con el porqué en `de` para poder explicarlo.
 *
 * `mios` y `delCentro` son bloqueos ya guardados ({ startAt, endAt }), los más
 * recientes primero; `tiposDeCita`, las duraciones en minutos de los tipos
 * activos. Todo puede venir vacío: entonces son 60, como hasta hoy.
 */
export function duracionSugeridaDeBloqueo({ mios = [], delCentro = [], tiposDeCita = [] } = {}) {
  const deLosMios = masRepetida(minutosUtiles(mios));
  if (deLosMios !== null) return { minutos: deLosMios, de: "mios" };

  const delEquipo = masRepetida(minutosUtiles(delCentro));
  if (delEquipo !== null) return { minutos: delEquipo, de: "centro" };

  const duraciones = (tiposDeCita ?? [])
    .map((d) => Math.round(Number(d)))
    .filter((d) => Number.isFinite(d) && d > 0 && d < MINUTOS_DE_UN_DIA);
  if (duraciones.length) return { minutos: Math.min(...duraciones), de: "tipos" };

  return { minutos: DURACION_POR_DEFECTO, de: "defecto" };
}
