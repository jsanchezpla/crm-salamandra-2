/**
 * lib/citas/siguientesIguales.js — «esta y las siguientes» sin que exista una
 * serie (11/09/2026, Aumenta).
 *
 * (Fichero en `/lib`, regla #2: la misma pregunta —«¿cuáles son las siguientes
 * de esta?»— la hacen la ficha de la cita al cambiar la hora, el modal del
 * bloqueo al quitarlo y sus dos endpoints. Escrita cuatro veces se separaría a
 * la primera.)
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 * Tres avisos del mismo día, 10/09/2026: Olga (AV-0118) «tengo que ir semana
 * por semana, en lugar de programar o desprogramar las citas»; Olga otra vez
 * (AV-0121) «¿no existe una forma para que pueda quitar [un bloqueo] desde el
 * miércoles 16 en adelante?»; Daniela (AV-0119) con dos tramos de los jueves
 * repetidos hasta junio que había que quitar. Y la mejora apuntada en el
 * Registro (AV-0107, AV-0054, AV-0105): «cuando hago un cambio en una cita,
 * debería preguntarme si quiero generalizar ese cambio a todas las que tiene
 * programadas para el futuro».
 *
 * ── POR QUÉ NO HAY SERIE, Y CÓMO SE SUPLE ──────────────────────────────────
 * Una cita repetida son N citas INDEPENDIENTES, a propósito (31/08/2026,
 * `recurrencia.js`): ninguna fila dice «estas cuarenta son la misma cosa». Las
 * 12.030 citas y los 10.000 bloqueos que ya existen tampoco lo dirían aunque
 * se añadiera la columna hoy. Así que «las siguientes» se DEDUCEN de lo que sí
 * está escrito: las que son iguales a esta en lo que las hace repetición —
 * misma persona, mismo día de la semana, misma hora de pared, misma duración,
 * mismo tipo (cita) o misma categoría y rótulo (bloqueo)— y vienen después.
 * Es la opción (a) del Registro: no toca la base, se puede deshacer una a una
 * y resuelve el caso real (mover la hora de un niño para el resto del curso).
 *
 * Lo que NO recoge, sabido: una repetición con excepciones (una semana a otra
 * hora) deja fuera esa semana, y dos repeticiones distintas que coincidan en
 * todo (mismo niño, mismo tipo, misma hora, mismo día) se ven como una. Las
 * dos cosas se dicen en pantalla con el número delante («hay 38 más así»),
 * que es lo que permite decir que no.
 *
 * ── HORA DE PARED, NO DE UTC ───────────────────────────────────────────────
 * «Los miércoles a las 15:30» es hora de Madrid. Comparar en UTC partiría la
 * serie en el cambio de hora de octubre: las de antes serían 13:30Z y las de
 * después 14:30Z. Se compara con las partes en Madrid (`getMadridParts`), y
 * al mover se reconstruye el instante con `buildMadridDate`, que ya sabe del
 * cambio de hora.
 */

import { buildMadridDate, getMadridParts } from "./slots.js";

/** Estados de una cita que cuentan como «programada» para esto. */
const VIVAS = new Set(["pending", "confirmed"]);

/** Hasta dónde se busca hacia delante: un curso y algo más. */
export const HORIZONTE_DIAS = 400;

const MS_DIA = 24 * 60 * 60 * 1000;

function fecha(v) {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** «HH:MM» y día de la semana (0 = domingo) en hora de Madrid. */
export function paredDe(instante) {
  const d = fecha(instante);
  if (!d) return null;
  const p = getMadridParts(d);
  // El día de la semana se saca del calendario de Madrid, no del de UTC: a las
  // 00:30 de Madrid en UTC todavía es el día anterior.
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return { dow, hhmm: `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`, y: p.year, m: p.month, d: p.day };
}

const texto = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");
const mismo = (a, b) => (a ?? null) === (b ?? null);

/** Minutos entre dos instantes, redondeados. */
function minutosEntre(a, b) {
  return Math.round((fecha(b).getTime() - fecha(a).getTime()) / 60000);
}

/**
 * ¿`otra` es una repetición de `base` que viene después?
 *
 * Igual en: a quién se le da (paciente; sin paciente, la familia; sin familia,
 * el correo o el nombre), qué es (tipo de cita), quién la da, cuánto dura, y
 * el día de la semana y la hora de pared. Solo vivas, y solo posteriores.
 *
 * @param base  la cita que se ha tocado (su estado ANTES de tocarla)
 * @param otra  una candidata
 */
export function esCitaSiguiente(base, otra) {
  if (!base || !otra || otra.id === base.id) return false;
  if (!VIVAS.has(otra.status)) return false;
  const tb = fecha(base.scheduledAt);
  const to = fecha(otra.scheduledAt);
  if (!tb || !to || to <= tb) return false;
  if (!mismo(base.eventTypeId, otra.eventTypeId)) return false;
  if (!mismo(base.teamMemberId, otra.teamMemberId)) return false;
  if (Number(base.duration) !== Number(otra.duration)) return false;
  if (base.tallerGrupoId || otra.tallerGrupoId) return false;
  if (base.patientId) {
    if (!mismo(base.patientId, otra.patientId)) return false;
  } else if (base.clientId) {
    if (!mismo(base.clientId, otra.clientId)) return false;
  } else if (texto(base.clientEmail)) {
    if (texto(base.clientEmail) !== texto(otra.clientEmail)) return false;
  } else if (texto(base.clientName) !== texto(otra.clientName)) {
    return false;
  }
  const pb = paredDe(tb);
  const po = paredDe(to);
  return pb.dow === po.dow && pb.hhmm === po.hhmm;
}

/**
 * ¿`otro` es una repetición de `base` (bloqueo) que viene después?
 *
 * Igual en: de quién es (null = cierre del centro), categoría, rótulo (sin
 * mayúsculas ni espacios de más), duración, día de la semana y hora de pared
 * del inicio.
 */
export function esBloqueoSiguiente(base, otro) {
  if (!base || !otro || otro.id === base.id) return false;
  const ib = fecha(base.startAt);
  const io = fecha(otro.startAt);
  if (!ib || !io || io <= ib) return false;
  if (!mismo(base.teamMemberId, otro.teamMemberId)) return false;
  if (!mismo(base.categoryKey || null, otro.categoryKey || null)) return false;
  if (texto(base.label) !== texto(otro.label)) return false;
  if (!mismo(base.tallerId || null, otro.tallerId || null)) return false;
  if (minutosEntre(base.startAt, base.endAt) !== minutosEntre(otro.startAt, otro.endAt)) return false;
  const pb = paredDe(ib);
  const po = paredDe(io);
  return pb.dow === po.dow && pb.hhmm === po.hhmm;
}

/**
 * El `where` de Sequelize que acota las candidatas ANTES de pasarlas por
 * `esCitaSiguiente`: lo barato en la base, lo fino en JavaScript. `Op` se pasa
 * desde fuera para que esto no dependa de sequelize.
 */
export function ventanaDeBusqueda(Op, desde, { horizonteDias = HORIZONTE_DIAS } = {}) {
  const d = fecha(desde);
  return { [Op.gt]: d, [Op.lt]: new Date(d.getTime() + horizonteDias * MS_DIA) };
}

/**
 * Cómo se movió la base: cuántos días de calendario (en Madrid) y a qué hora
 * de pared queda. Es lo que se aplica a cada una de las siguientes.
 *
 * @returns {{ dias: number, hhmm: string }}
 */
export function desplazamiento(antes, despues) {
  const pa = paredDe(antes);
  const pd = paredDe(despues);
  const diaA = Date.UTC(pa.y, pa.m - 1, pa.d);
  const diaD = Date.UTC(pd.y, pd.m - 1, pd.d);
  return { dias: Math.round((diaD - diaA) / MS_DIA), hhmm: pd.hhmm };
}

/**
 * El instante al que va una de las siguientes: su día de calendario en Madrid
 * más `dias`, a la hora `hhmm` de Madrid. Se reconstruye con `buildMadridDate`
 * para que una cita de diciembre movida desde septiembre siga siendo «a las
 * 14:15» y no «a las 14:15 menos una hora».
 */
export function instanteMovido(scheduledAt, { dias, hhmm }) {
  const p = paredDe(scheduledAt);
  const dia = new Date(Date.UTC(p.y, p.m - 1, p.d) + dias * MS_DIA);
  const [hh, mm] = String(hhmm).split(":").map(Number);
  return buildMadridDate(dia.getUTCFullYear(), dia.getUTCMonth() + 1, dia.getUTCDate(), hh, mm);
}

/** «hasta el 24/06/2027» para el texto de la pregunta. */
export function fechaCorta(instante) {
  const p = paredDe(instante);
  if (!p) return "";
  return `${String(p.d).padStart(2, "0")}/${String(p.m).padStart(2, "0")}/${p.y}`;
}
