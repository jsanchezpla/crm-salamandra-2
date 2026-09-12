/**
 * lib/clinica/adoptarEnDiagnostico.js — «Empezar desde lo que ya hay»: qué
 * citas, qué entrevista y qué cobro de un paciente se METEN en un expediente
 * de diagnóstico que se abre después de haber empezado (12/09/2026, ampliación
 * tras las respuestas de Aumenta; Isa por Rodrigo).
 *
 * (Fichero nuevo en /lib, regla #2: la misma regla la necesitan el buscador
 * de candidatos —`GET /api/clinica/diagnosticos/candidatos`, que la aplica a
 * cientos de pacientes sobre lo que trae UNA consulta por tabla—, el alta que
 * adopta —`POST /api/clinica/diagnosticos`, que la RECALCULA en el servidor y
 * nunca acepta ids de citas del navegador— y la casilla de la pantalla, que
 * enseña la frase de lo que va a entrar. Tres copias serían tres respuestas
 * distintas a «¿cuántas horas lleva Lea?». PURO a propósito: sin ORM.)
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 * Aumenta tiene 6 pacientes YA en diagnóstico, con citas dadas y futuras, y
 * dijeron que los dan de alta ellos: «lo único que hay que saber cómo
 * hacerlo». Y dos reglas de negocio que cambian el reparto:
 *
 *   (B) Las citas de los tipos «INFORME PARA DIAGNOSTICO» (45 min) SON horas
 *       del diagnóstico: «se cuentan dentro de las 19 h». Se reconocen por la
 *       columna `event_types.informe_tipo = 'diagnostico'`, no por el nombre.
 *   (B) Una entrevista inicial de terapia hecha ANTES de decidir el
 *       diagnóstico cuenta como la primera hora, y sus 50 € ya cobrados se
 *       DESCUENTAN del producto («los 50 € de la entrevista inicial de Lea
 *       descuentan del importe de la valoración completa»). Se reconoce por
 *       `event_types.is_initial_assessment`.
 *
 * Nada de Aumenta a fuego: ni ids ni nombres; la regla es POR ESAS COLUMNAS.
 *
 * ── LO QUE CUENTA COMO HECHA Y COMO RESERVADA ──────────────────────────────
 * La regla de los bonos y del expediente (`gastaSesion` / `reservaSesion`),
 * sin inventar otra. Dato real: en Aumenta las citas pasadas se quedan en
 * `confirmed` (nadie las marca «hecha»), así que una pasada sin cerrar se
 * cuenta como RESERVADA, igual que la barra la pinta. No se cambia aquí: se
 * dice en la doc y en la guía.
 */

import { gastaSesion, reservaSesion } from "../citas/gastaSesion.js";
import { TRAMO_ENTREVISTA, TRAMO_HORAS } from "../citas/altaDesdeDiagnostico.js";
import { formatoHoras } from "./diagnostico.js";

const redondea = (n) => Math.round((Number(n) || 0) * 100) / 100;

/* ═══ Los tipos de cita ════════════════════════════════════════════════════ */

/** ¿Las citas de este tipo son HORAS de un diagnóstico? (`informe_tipo = 'diagnostico'`) */
export function esTipoDeHorasDeDiagnostico(tipo) {
  if (!tipo || typeof tipo !== "object") return false;
  return (tipo.informeTipo ?? tipo.informe_tipo) === "diagnostico";
}

/** ¿Es el tipo de la ENTREVISTA INICIAL del centro? (`is_initial_assessment`) */
export function esTipoDeEntrevista(tipo) {
  if (!tipo || typeof tipo !== "object") return false;
  return (tipo.isInitialAssessment ?? tipo.is_initial_assessment) === true;
}

/**
 * En qué TRAMO entra una cita si se adopta: `entrevista` si su tipo es el de
 * la entrevista inicial, o si es de diagnóstico y su nota dice «entrevista
 * inicial» (así nacen las del expediente); `horas` si su tipo es de
 * diagnóstico; `null` si no es de ninguno de los dos.
 */
export function tramoDeAdopcion(cita, tipoDeLaCita) {
  if (esTipoDeEntrevista(tipoDeLaCita)) return TRAMO_ENTREVISTA;
  if (!esTipoDeHorasDeDiagnostico(tipoDeLaCita)) return null;
  return /entrevista inicial/i.test(String(cita?.notes ?? "")) ? TRAMO_ENTREVISTA : TRAMO_HORAS;
}

/* ═══ Las citas ════════════════════════════════════════════════════════════ */

/** El instante de una cita, o 0 si no se lee. */
function cuando(c) {
  const t = new Date(c?.scheduledAt ?? 0).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Horas de una cita por su duración (la entrevista vale 1 en la barra, pero aquí se resume lo que se adopta). */
function horasDe(cita) {
  const min = Number(cita?.duration);
  return Number.isFinite(min) && min > 0 ? min / 60 : 0;
}

/** `tiposPorId` puede ser un Map, un objeto plano o nada. */
function tipoDe(tiposPorId, id) {
  if (id === null || id === undefined) return null;
  if (tiposPorId instanceof Map) return tiposPorId.get(String(id)) ?? tiposPorId.get(id) ?? null;
  if (tiposPorId && typeof tiposPorId === "object") return tiposPorId[String(id)] ?? null;
  return null;
}

function aJson(c) {
  return c?.toJSON ? c.toJSON() : c;
}

/**
 * Qué citas del paciente ENTRAN en el expediente que se abre.
 *
 *   citas               las del paciente (con `eventTypeId`, `status`,
 *                       `scheduledAt`, `duration`, `notes`, `diagnosticoId`)
 *   tiposPorId          Map/objeto id → tipo de cita (`informeTipo`,
 *                       `isInitialAssessment`)
 *   entrevistaBookingId la que quien abre señala como entrevista (tiene que
 *                       ser adoptable: de un tipo de entrevista o de
 *                       diagnóstico); sin ella, la ÚLTIMA de tramo entrevista
 *
 * Fuera quedan las que ya son de un expediente (`diagnosticoId`) y las
 * canceladas: una cita cancelada a tiempo no es una hora, y una cancelada
 * tarde ya se la cobró el bono de entonces. Devuelve la entrevista (o null),
 * las de horas y el resumen de esas horas —la entrevista va aparte, no suma
 * en `citas`—.
 */
export function citasAdoptables({ citas, tiposPorId = null, entrevistaBookingId = null, ahora = new Date() } = {}) {
  const lista = (Array.isArray(citas) ? citas : []).map(aJson).filter(Boolean);
  const candidatas = [];
  for (const c of lista) {
    if (c.diagnosticoId) continue;
    if (c.status === "cancelled") continue;
    const tramo = tramoDeAdopcion(c, tipoDe(tiposPorId, c.eventTypeId));
    if (!tramo) continue;
    candidatas.push({ cita: c, tramo });
  }
  candidatas.sort((a, b) => cuando(a.cita) - cuando(b.cita));

  const pedida = String(entrevistaBookingId ?? "").trim();
  let entrevista = pedida ? (candidatas.find((x) => String(x.cita.id) === pedida)?.cita ?? null) : null;
  if (!entrevista) {
    const deEntrevista = candidatas.filter((x) => x.tramo === TRAMO_ENTREVISTA);
    entrevista = deEntrevista.length ? deEntrevista.at(-1).cita : null;
  }

  // Las horas son las de tipo de diagnóstico que no sean LA entrevista. Una
  // segunda cita de tipo ENTREVISTA INICIAL (de terapia) no entra: no es una
  // hora de diagnóstico y solo una puede ser la entrevista.
  const horas = candidatas
    .filter((x) => x.cita !== entrevista && esTipoDeHorasDeDiagnostico(tipoDe(tiposPorId, x.cita.eventTypeId)))
    .map((x) => x.cita);

  let hechas = 0;
  let horasHechas = 0;
  let futuras = 0;
  let horasReservadas = 0;
  for (const c of horas) {
    if (gastaSesion(c, ahora)) {
      hechas += 1;
      horasHechas += horasDe(c);
    } else if (reservaSesion(c)) {
      futuras += 1;
      horasReservadas += horasDe(c);
    }
  }

  return {
    entrevista,
    horas,
    resumen: {
      citas: horas.length,
      hechas,
      horasHechas: redondea(horasHechas),
      futuras,
      horasReservadas: redondea(horasReservadas),
    },
  };
}

/* ═══ El dinero ════════════════════════════════════════════════════════════ */

/**
 * Cuánto se DESCUENTA del producto por la entrevista ya cobrada: el importe
 * del cobro si existe, está cobrado o pendiente y no se ha devuelto; si no, 0.
 * Un pendiente también descuenta: la familia debe la entrevista, no la
 * entrevista más el producto entero.
 */
export function descuentoDeLaEntrevista(pago) {
  const p = aJson(pago);
  if (!p || typeof p !== "object") return 0;
  if (p.refundedAt || p.status === "refunded") return 0;
  if (p.status !== "completed" && p.status !== "pending") return 0;
  const n = Number(p.amount);
  return Number.isFinite(n) && n > 0 ? redondea(n) : 0;
}

/* ═══ La frase de la casilla ═══════════════════════════════════════════════ */

/** «03/09/2026», o «» si no se lee. */
function fechaCorta(valor) {
  const d = new Date(valor ?? NaN);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** «50 €», «47,50 €». */
function euros(n) {
  const v = redondea(n);
  return `${Number.isInteger(v) ? String(v) : v.toFixed(2).replace(".", ",")} €`;
}

/** «a», «a y b», «a, b y c». */
function enumera(partes) {
  if (partes.length <= 1) return partes.join("");
  return `${partes.slice(0, -1).join(", ")} y ${partes.at(-1)}`;
}

/**
 * La frase de la casilla «Meter en el expediente lo que ya hay: …»: «3 citas
 * ya dadas (2,5 h), 2 futuras (1,5 h) y la entrevista del 03/09/2026
 * (cobrada, 50 €)». «nada que meter» si no hay nada.
 *
 *   resumen         el de `citasAdoptables`
 *   entrevista      la cita de la entrevista (o null)
 *   cobroEntrevista su cobro `{ importe, status }` (o null)
 */
export function resumenDeAdopcion({ resumen = null, entrevista = null, cobroEntrevista = null } = {}) {
  const r = resumen && typeof resumen === "object" ? resumen : {};
  const hechas = Number(r.hechas) || 0;
  const futuras = Number(r.futuras) || 0;
  const partes = [];
  if (hechas > 0) partes.push(`${hechas} cita${hechas === 1 ? "" : "s"} ya dada${hechas === 1 ? "" : "s"} (${formatoHoras(r.horasHechas)} h)`);
  if (futuras > 0) {
    const s = futuras === 1 ? "" : "s";
    // Con «citas ya dadas» delante, «2 futuras» se entiende; sin nada delante
    // hace falta el sustantivo: «2 citas futuras».
    const palabra = hechas > 0 ? `futura${s}` : `cita${s} futura${s}`;
    partes.push(`${futuras} ${palabra} (${formatoHoras(r.horasReservadas)} h)`);
  }
  if (entrevista) {
    const fecha = fechaCorta(entrevista.scheduledAt);
    const cuando = fecha ? ` del ${fecha}` : "";
    let dinero = "sin cobro";
    if (cobroEntrevista && typeof cobroEntrevista === "object") {
      const importe = euros(cobroEntrevista.importe ?? cobroEntrevista.amount);
      if (cobroEntrevista.status === "completed") dinero = `cobrada, ${importe}`;
      else if (cobroEntrevista.status === "pending") dinero = `pendiente de cobro, ${importe}`;
    }
    partes.push(`la entrevista${cuando} (${dinero})`);
  }
  return partes.length ? enumera(partes) : "nada que meter";
}

/* ═══ El terapeuta ═════════════════════════════════════════════════════════ */

/**
 * El terapeuta que más se repite en esas citas (`teamMemberId`), o null: es
 * el que se propone como asignado del expediente. Un empate lo gana el de la
 * cita más reciente, que es quien lo lleva ahora.
 */
export function terapeutaSugerido(citas) {
  const lista = (Array.isArray(citas) ? citas : []).map(aJson).filter((c) => c && c.teamMemberId);
  if (!lista.length) return null;
  const cuenta = new Map();
  const ultima = new Map();
  for (const c of lista) {
    const id = String(c.teamMemberId);
    cuenta.set(id, (cuenta.get(id) ?? 0) + 1);
    ultima.set(id, Math.max(ultima.get(id) ?? 0, cuando(c)));
  }
  let mejor = null;
  for (const [id, n] of cuenta) {
    if (!mejor || n > mejor.n || (n === mejor.n && ultima.get(id) > ultima.get(mejor.id))) mejor = { id, n };
  }
  return mejor ? mejor.id : null;
}
