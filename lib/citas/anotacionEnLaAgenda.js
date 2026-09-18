/**
 * lib/citas/anotacionEnLaAgenda.js — la anotación de una cita, en la rejilla
 * (18/09/2026, AV-0211 de Aumenta).
 *
 * ── DE QUÉ PETICIÓN REAL NACE ──────────────────────────────────────────────
 * Olga: «queremos poder escribir, ya se puede porque hay un espacio para ello
 * cuando creamos la cita, pero queremos que se vea las anotaciones
 * realizadas». Manda una captura de Organízate, donde la anotación de un
 * martes se lee en la propia casilla del horario.
 *
 * El dato nunca faltó: `bookings.notes` se guarda bien y se ve al abrir la
 * cita. Lo que no llegaba a la rejilla era el campo — el endpoint de la agenda
 * no lo mandaba— así que para leer una anotación había que abrir la cita, y
 * quien coge el horario para avisar a las familias no va a abrir 103 citas.
 *
 * ── POR QUÉ CABE, MEDIDO ───────────────────────────────────────────────────
 * En producción el 18/09/2026, Aumenta: 423 citas anotadas de 14.566, media de
 * 47 caracteres, la más larga 142, NINGUNA con salto de línea y solo 3 por
 * encima de 60. O sea que son recados cortos («viene la abuela», «traer
 * informe»), no párrafos: en una línea debajo del nombre se leen enteras.
 *
 * ── LAS DOS REGLAS ─────────────────────────────────────────────────────────
 * 1. La anotación se acorta AQUÍ, en el servidor, a una línea. No es solo
 *    cosmética: así por el cable viaja el recado y no el texto entero, que es
 *    campo libre en un centro clínico.
 * 2. Solo se pinta donde la caja tiene alto: semana, día y tres días. En MES y
 *    en LISTA la caja es una línea y ya la ocupa el nombre; ahí la anotación se
 *    queda en el emergente del ratón, que no ensancha nada.
 *
 * Es interna a propósito (`notes` es «notas internas, no visibles al cliente»),
 * y en Aumenta la agenda la ve todo el equipo desde el 01/08/2026: en esa
 * rejilla ya se leen el nombre del paciente y la terapia, así que la anotación
 * no descubre a nadie nuevo — pero conviene saberlo al escribirla.
 */

/** Lo que cabe en la caja sin empujar nada: 3 de 423 llegaron a cortarse. */
export const LARGO_ANOTACION = 60;

/**
 * El recado de una cita en una sola línea, o `null` si no hay.
 *
 * Aplana saltos y espacios de más —una anotación escrita en dos renglones
 * rompería el alto de la caja— y corta con «…» lo que no quepa, que se lee como
 * lo que es: hay más al abrir la cita.
 *
 * @param {string|null|undefined} notes  el `bookings.notes` crudo
 * @param {{ largo?: number }} [opciones]
 * @returns {string|null}
 */
export function anotacionParaLaAgenda(notes, { largo = LARGO_ANOTACION } = {}) {
  if (typeof notes !== "string") return null;
  const limpia = notes.replace(/\s+/g, " ").trim();
  if (!limpia) return null;
  if (limpia.length <= largo) return limpia;
  // Se corta por la última palabra entera que quepa, para no partir un nombre
  // por la mitad; si la primera palabra ya no cabe, se corta a lo bruto.
  const recorte = limpia.slice(0, largo);
  const hueco = recorte.lastIndexOf(" ");
  return `${(hueco > largo * 0.6 ? recorte.slice(0, hueco) : recorte).trimEnd()}…`;
}

/**
 * ¿Esta vista tiene alto de sobra para una segunda línea en la caja?
 *
 * Sí en las de rejilla horaria (`timeGridWeek`, `timeGridDay`,
 * `timeGridTresDias`), que es donde la caja mide lo que dura la cita. No en
 * `dayGridMonth` ni en `listWeek`, de una línea.
 *
 * @param {string|null|undefined} vista  el `view.type` de FullCalendar
 * @returns {boolean}
 */
export function laCajaEnseñaLaAnotacion(vista) {
  return typeof vista === "string" && vista.startsWith("timeGrid");
}
