/**
 * lib/clinica/planDesdeInformes.js — el Plan trae el motivo de consulta de los
 * informes que el paciente ya tiene subidos (15/09/2026, AV-0103 de Silvia).
 *
 * ── DE QUÉ PETICIÓN NACE ───────────────────────────────────────────────────
 * Los informes de Aumenta —«INFORME DE EVOLUCIÓN Servicio de LOGOPEDIA - Junio
 * 2026.pdf» y parecidos— abren con «MOTIVO DE CONSULTA»: por qué acude, a qué
 * terapia y con qué trastorno. En producción hay 3.034 PDF con «informe» en el
 * nombre, de 641 pacientes. Todo eso ya está escrito; lo que faltaba era
 * traerlo al Plan sin teclearlo otra vez.
 *
 * ── COMO LA ENTREVISTA: COPIAR, NO REDACTAR ────────────────────────────────
 * Gemelo de `planDesdeEntrevista.js`. Se copia LITERAL el apartado, desde su
 * encabezado hasta el siguiente, sin IA: no cuesta nada, no se inventa nada y
 * sale igual siempre. Solo se reúnen las líneas que el PDF parte al maquetar.
 *
 * ── EL MOTIVO VA A SU TERAPIA ──────────────────────────────────────────────
 * Desde AV-0143 cada terapeuta tiene su motivo. La terapia del informe sale del
 * nombre del fichero («Servicio de LOGOPEDIA») y, si no la dice, de la primera
 * que nombre el propio motivo («acude al área de PSICOLOGÍA»). Va a la terapeuta
 * del paciente con esa especialidad; si no hay ninguna, al motivo general.
 *
 * ── EL DIAGNÓSTICO, SOLO SI ESTÁ ESCRITO ───────────────────────────────────
 * Solo cuando el informe tiene un apartado que SE LLAMA diagnóstico («6. Juicio
 * clínico – Diagnóstico», «Conclusión diagnóstica»). Nunca se deduce del motivo
 * aunque diga «presenta diagnóstico de TEA»: eso es de quien puede darlo.
 *
 * ── LO QUE MIDIÓ LA MUESTRA (39 informes de producción) ────────────────────
 * 28 con texto y el encabezado limpio, que acaba casi siempre en «OBJETIVOS…»
 * o «2. Situación familiar y educativa»; 2 escaneados (sin texto), 3 cifrados y
 * 6 que no son de ese tipo (una ortesis, un perfil SENA, un grupo). Por eso es
 * un botón por paciente que enseña lo que encuentra, no un volcado a ciegas.
 *
 * Puro: sin disco y sin base. Prueba en `scripts/_smoke-plan-desde-informes.mjs`.
 */

import { MAX_TEXTO_MOTIVO, motivoDe } from "./motivosDelPlan.js";

/** Lo que admite el PUT del plan (`app/api/pacientes/[id]/plan/route.js`). */
export const MAX_MOTIVO_GENERAL = 4000;
export const MAX_DIAGNOSTICO = 2000;

/** ¿Este documento es un informe? Lo dice su nombre, como lo dice el centro. */
export function esInforme(fileName) {
  return /informe/i.test(String(fileName ?? "")) && /\.pdf$/i.test(String(fileName ?? "").trim());
}

const sinTildes = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "");

const MOTIVO_RE = /^(\d+\s*[.)]\s*)?motivo de (la )?consulta\s*:?\s*(.*)$/i;
const DIAGNOSTICO_RE =
  /^(\d+\s*[.)]\s*)?(juicio clinico\s*[-–—]?\s*diagnostico|conclusion(es)? diagnosticas?|diagnostico( principal)?)\s*:?\s*$/i;

/** Un encabezado: «2. Situación familiar» o una línea corta toda en mayúsculas. */
function esEncabezado(linea) {
  if (!linea || linea.length > 80) return false;
  if (/^\d+\s*[.)]\s+\p{Lu}/u.test(linea) && !/[.,;]$/.test(linea)) return true;
  const letras = linea.replace(/[^\p{L}]/gu, "");
  return letras.length >= 4 && linea === linea.toLocaleUpperCase("es");
}

const VINETA_RE = /^[•●▪◦■\-–o]\s/;

/**
 * Las líneas de un apartado, unidas como se escribieron: el PDF corta cada
 * renglón y aquí se vuelve a juntar la frase. Punto y aparte o viñeta, línea
 * nueva; lo demás, un espacio. Las palabras no se tocan.
 */
function unirLineas(lineas) {
  let salida = "";
  for (const l of lineas) {
    if (!salida) { salida = l; continue; }
    const aparte = /[.:!?]$/.test(salida) || VINETA_RE.test(l) || /^[•●▪◦■\-–]$/.test(salida.split("\n").pop());
    salida += aparte ? `\n${l}` : ` ${l}`;
  }
  return salida.replace(/[ \t]{2,}/g, " ").trim();
}

/**
 * El texto de un apartado que empieza en un encabezado que casa con `re`.
 *
 * Se prueba cada aparición: la primera suele ser el ÍNDICE («1. Motivo de la
 * consulta» seguido de «2. …»), que no tiene nada debajo. Las cabeceras y pies
 * de página se reconocen porque se repiten línea por línea en el documento, y
 * se saltan si el apartado cruza de página.
 */
function apartado(texto, re, { max }) {
  const lineas = String(texto ?? "").replace(/\p{Cf}/gu, "").split(/\r?\n/).map((l) => l.trim());
  // El número de página cambia en cada pie: se cuentan con las cifras tapadas.
  const clave = (l) => l.replace(/\d+/g, "#");
  const veces = new Map();
  for (const l of lineas) if (l) veces.set(clave(l), (veces.get(clave(l)) ?? 0) + 1);

  for (let i = 0; i < lineas.length; i++) {
    const m = sinTildes(lineas[i]).match(re);
    if (!m) continue;
    const cuerpo = [];
    const enLinea = re === MOTIVO_RE ? lineas[i].slice(lineas[i].length - (m[3] ?? "").length).trim() : "";
    if (enLinea) cuerpo.push(enLinea);
    for (let j = i + 1; j < lineas.length; j++) {
      const l = lineas[j];
      if (!l) continue;
      if (esEncabezado(l)) break;
      if ((veces.get(clave(l)) ?? 0) > 1 && l.length < 120) continue; // cabecera o pie de página
      if (/^p[aá]gina\b|^\d+\s*(\/\s*\d+)?$/i.test(l)) continue;
      cuerpo.push(l);
    }
    const t = unirLineas(cuerpo);
    if (t.length < 20) continue; // el índice, o un encabezado suelto
    // Demasiado largo para su campo: se deja entero en el informe antes que cortar a medias.
    if (t.length > max) return { texto: null, demasiadoLargo: true };
    return { texto: t, demasiadoLargo: false };
  }
  return { texto: null, demasiadoLargo: false };
}

/** El motivo de consulta y, si lo tiene con su nombre, el diagnóstico. */
export function leerInforme(texto) {
  const motivo = apartado(texto, MOTIVO_RE, { max: MAX_TEXTO_MOTIVO });
  const diagnostico = apartado(texto, DIAGNOSTICO_RE, { max: MAX_DIAGNOSTICO });
  return {
    motivo: motivo.texto,
    motivoDemasiadoLargo: motivo.demasiadoLargo,
    diagnostico: diagnostico.texto,
  };
}

/**
 * Cómo se nombra cada terapia en los informes. «psicopedagógico» no es ni
 * psicología ni pedagogía, y «rehabilitación» no está porque es el nombre del
 * propio centro en los membretes.
 */
const TERAPIAS = [
  ["neuropsicologia", /neuropsicolog/i],
  ["psicologia", /(?<!neuro)psicolog/i],
  ["logopedia", /logoped|reeducacion del lenguaje/i],
  ["pedagogia", /(?<!psico)pedagog/i],
  ["terapia_ocupacional", /terapia ocupacional/i],
  ["fisioterapia", /fisioterap/i],
  ["atencion_temprana", /atencion temprana/i],
];

function terapiasEn(texto) {
  const t = sinTildes(texto);
  return TERAPIAS.map(([k, re]) => ({ k, i: t.search(re) })).filter((x) => x.i >= 0).sort((a, b) => a.i - b.i);
}

/**
 * A qué terapia es el informe: «Servicio de X» en el nombre; si no, la única
 * que nombre el fichero (o «T.O»); si no, la PRIMERA que nombre el arranque del
 * motivo, que es donde va «acude al área de…». Solo el arranque: más abajo se
 * cuentan terapias de antes y derivaciones («anteriormente acudía a logopedia»).
 * Si nada lo dice, null, y el motivo va al general.
 */
export function terapiaDelInforme(fileName, motivo) {
  const nombre = String(fileName ?? "");
  const servicio = sinTildes(nombre).match(/servicio de\s+([\p{L} ]+?)(\s+-|\.pdf|$)/iu);
  if (servicio) {
    const t = terapiasEn(servicio[1]);
    if (t.length) return t[0].k;
  }
  const enNombre = [...new Set(terapiasEn(nombre).map((x) => x.k))];
  if (enNombre.length === 1) return enNombre[0];
  if (/\bT\.\s?O\b/.test(nombre)) return "terapia_ocupacional";
  return terapiasEn(String(motivo ?? "").slice(0, 300))[0]?.k ?? null;
}

const vacio = (v) => !(typeof v === "string" && v.trim());

/**
 * Lo que el Plan puede traer de los informes, y SOLO en lo que esté vacío.
 *
 * `informes`: `[{ fileName, fecha, texto, problema }]` del más nuevo al más
 * viejo (`texto` a null y `problema` "cifrado" o "sin texto" si no se pudo
 * leer). Gana el informe más reciente de cada terapia, que es el que dice cómo
 * está hoy. `terapeutas`: `[{ id, especialidades: [] }]` del paciente.
 *
 * Devuelve lo que se rellena, de qué fichero sale cada cosa y el recuento de lo
 * que no se pudo leer, para decírselo a quien pulsa.
 */
export function rellenoDesdeInformes(plan = {}, terapeutas = [], informes = []) {
  const motivos = [];
  let general = null;
  let diagnostico = null;
  const cuenta = { leidos: 0, cifrados: 0, sinTexto: 0, sinMotivo: 0 };

  for (const inf of informes) {
    if (!inf?.texto || inf.texto.trim().length < 20) {
      if (inf?.problema === "cifrado") cuenta.cifrados++;
      else cuenta.sinTexto++;
      continue;
    }
    cuenta.leidos++;
    const leido = leerInforme(inf.texto);
    const origen = { fileName: inf.fileName, fecha: inf.fecha ?? null };

    if (leido.diagnostico && !diagnostico && vacio(plan.diagnosis)) {
      diagnostico = { texto: leido.diagnostico, ...origen };
    }
    if (!leido.motivo) { cuenta.sinMotivo++; continue; }

    const terapia = terapiaDelInforme(inf.fileName, leido.motivo);
    const suyas = terapia ? terapeutas.filter((t) => (t.especialidades ?? []).includes(terapia)) : [];
    if (suyas.length) {
      for (const t of suyas) {
        if (motivos.some((m) => m.terapeutaId === t.id)) continue; // ya lo trajo uno más nuevo
        if (motivoDe(plan.consultationReasonsByTherapist, t.id)) continue; // lo suyo no se pisa
        motivos.push({ terapeutaId: t.id, texto: leido.motivo, terapia, ...origen });
      }
    } else if (!general && vacio(plan.consultationReasons) && leido.motivo.length <= MAX_MOTIVO_GENERAL) {
      general = { texto: leido.motivo, terapia, ...origen };
    }
  }

  return { motivos, general, diagnostico, cuenta };
}
