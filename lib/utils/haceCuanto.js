/**
 * lib/utils/haceCuanto.js — «hace un rato», «ayer», «hace 3 días»
 * (09/09/2026, AV-0091).
 *
 * ── DE QUÉ AVISO NACE ───────────────────────────────────────────────────────
 * Laura Barbero (nutri_laura, 09/09/2026): «Hoy es 09/09/2026, y veo que un
 * formulario rellenado, que se realizó el día 07/09/2026, sale como "ayer"
 * cuando fue antes de ayer».
 *
 * Tenía razón, y el fallo estaba escrito CUATRO veces —la bandeja de
 * formularios, los chips de citas, el helpdesk y la campana del buzón—, las
 * cuatro igual: se contaban HORAS y se dividían entre 24.
 *
 *     const dias = Math.floor(horas / 24);
 *     return dias === 1 ? "ayer" : `hace ${dias} días`;
 *
 * Un formulario del lunes a las 18:00 visto el miércoles a las 11:23 lleva 41
 * horas, o sea «1 día» por esa cuenta, o sea «ayer». Pero el lunes no fue ayer:
 * fue anteayer. Con cualquier hueco entre 24 y 48 horas la palabra sale mal, y
 * cuanto más tarde en el día se escribió, peor.
 *
 * ── LO QUE SE ARREGLA ───────────────────────────────────────────────────────
 * «Ayer» no es una cantidad de horas: es un DÍA DEL CALENDARIO. Así que se
 * comparan los días civiles (en Europe/Madrid, como todo lo demás del CRM), no
 * los milisegundos transcurridos. Lo de menos de una hora sigue contándose en
 * minutos, que es como se lee bien lo recién hecho.
 *
 * (Fichero nuevo en /lib, regla #2: cuatro copias de la misma cuenta es
 * exactamente lo que hace que un fallo se arregle en un sitio y siga vivo en
 * los otros tres.)
 *
 * Puro y con prueba en `scripts/_smoke-hace-cuanto.mjs`.
 */

/** La zona en la que vive el centro: es la que decide qué día es «hoy». */
export const ZONA = "Europe/Madrid";

/**
 * El DÍA CIVIL de un instante, como `2026-09-07`. Es lo que hay que comparar
 * para decir «ayer»: dos instantes separados por 20 minutos pueden ser de días
 * distintos, y dos separados por 40 horas pueden no serlo.
 */
export function diaCivil(valor, zona = ZONA) {
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return null;
  const partes = d.toLocaleDateString("es-ES", { timeZone: zona, day: "2-digit", month: "2-digit", year: "numeric" });
  const [dia, mes, ano] = partes.split("/");
  return `${ano}-${mes}-${dia}`;
}

/** Días de calendario entre dos días civiles (`2026-09-07` → `2026-09-09` = 2). */
export function diasDeCalendario(desdeISO, hastaISO) {
  if (!desdeISO || !hastaISO) return 0;
  // Mediodía UTC: así ningún cambio de hora mueve la cuenta.
  const a = Date.parse(`${desdeISO}T12:00:00Z`);
  const b = Date.parse(`${hastaISO}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Cuánto hace, en cristiano.
 *
 * @param {*} valor            La fecha (lo que sea que acepte `new Date`).
 * @param {object} [opciones]
 * @param {number} [opciones.ahora]  Para poder probarlo sin depender del reloj.
 * @param {boolean} [opciones.largo] «hace 1 minuto» en vez de «hace 1 min».
 * @param {string}  [opciones.zona]
 */
export function haceCuanto(valor, { ahora = Date.now(), largo = false, zona = ZONA } = {}) {
  if (!valor) return "";
  const t = new Date(valor).getTime();
  if (Number.isNaN(t)) return "";

  const ms = ahora - t;
  if (ms < 0) return "en el futuro";

  const minutos = Math.floor(ms / 60_000);
  if (minutos < 1) return largo ? "hace un momento" : "ahora mismo";
  if (minutos < 60) return largo ? (minutos === 1 ? "hace 1 minuto" : `hace ${minutos} minutos`) : `hace ${minutos} min`;

  // A partir de aquí manda el CALENDARIO, no las horas transcurridas.
  const dias = diasDeCalendario(diaCivil(t, zona), diaCivil(ahora, zona));
  if (dias <= 0) {
    const horas = Math.floor(minutos / 60);
    return largo ? (horas === 1 ? "hace 1 hora" : `hace ${horas} horas`) : `hace ${horas} h`;
  }
  if (dias === 1) return "ayer";
  return `hace ${dias} días`;
}
