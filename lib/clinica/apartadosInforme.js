/**
 * lib/clinica/apartadosInforme.js — qué apartados salen impresos, en qué orden
 * y con qué número.
 *
 * (Fichero nuevo en /lib, regla #2: hasta hoy esta decisión vivía enterrada en
 * el bucle del generador, y con el rediseño pasa a imprimirse DOS veces —en el
 * índice de la página 2 y en el cuerpo—. Dos sitios leyendo la misma lista se
 * desincronizan el día que alguien añada un apartado; uno solo, no.)
 *
 * ── LO QUE FIJA, Y POR QUÉ IMPORTA ─────────────────────────────────────────
 *
 *   · Los apartados VACÍOS no se imprimen y NO GASTAN NÚMERO. Es la regla que
 *     ya existía —un informe de derivación no tiene «logros», y dejar el
 *     titular vacío parece un error de la clínica—, pero con índice se vuelve
 *     visible: numerar la lista fija dejaría un índice con huecos («1, 3, 6»)
 *     y un cuerpo que no casa con él.
 *   · El informe de BECA imprime SUS TRES apartados y ninguno más, aunque el
 *     resto esté escrito: la convocatoria pide lo que pide
 *     (`lib/clinica/beca.js`, que sigue siendo el dueño de esa lista).
 *   · El texto que redactó la IA y que aún no se ha repartido en apartados se
 *     imprime tal cual, como un apartado más, antes que entregar un PDF en
 *     blanco. En la beca NO: ese texto trae el informe entero y allí solo
 *     pueden viajar sus tres apartados.
 *
 * ── LOS RÓTULOS SON LOS DEL DOCUMENTO, NO LOS DE LA PANTALLA ───────────────
 * El cajón donde se redacta dice «Objetivos terapéuticos» y «Evolución
 * observada»; el documento que recibe la familia dice «Objetivos» y
 * «Evolución». Se conserva a propósito: la pantalla habla con la profesional y
 * el PDF habla con la familia.
 */

import { esInformeBeca, SECCIONES_BECA } from "./beca.js";

/** Orden de lectura del informe clínico. `lista: true` → viñetas. */
export const SECCIONES = [
  { key: "motiveOfIntervention", label: "Motivo de intervención", lista: false },
  { key: "objectives", label: "Objetivos", lista: true },
  { key: "evolution", label: "Evolución", lista: true },
  { key: "achievements", label: "Logros", lista: true },
  { key: "persistentDifficulties", label: "Dificultades que persisten", lista: true },
  { key: "recommendations", label: "Recomendaciones", lista: true },
  { key: "continuityProposal", label: "Propuesta de continuidad", lista: false },
];

const texto = (v) => (v == null ? "" : String(v).trim());

/**
 * El contenido de un apartado, siempre como lista de párrafos.
 *
 * Un apartado de lista guarda un array; uno de texto libre guarda una cadena
 * que puede traer saltos de línea. Los dos acaban igual aquí, y el generador
 * decide si los pinta con viñeta o como párrafos.
 */
export function parrafosDe(valor, esLista) {
  if (esLista) {
    if (Array.isArray(valor)) return valor.map(texto).filter(Boolean);
    return texto(valor) ? [texto(valor)] : [];
  }
  const t = texto(valor);
  if (!t) return [];
  // El texto libre viene de un textarea: los saltos dobles son párrafos.
  return t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

/**
 * Los apartados que este informe va a imprimir, numerados del 1 en adelante.
 *
 * Devuelve `[{ n, key, label, lista, parrafos }]`. La numeración es la del
 * DOCUMENTO: cuenta solo lo que se imprime, así que si el segundo apartado está
 * vacío, el tercero es el número 2.
 *
 * `n` sale como número, no como cadena: quien lo pinta decide si le pone punto.
 */
export function apartadosDelInforme(report) {
  const cs = report?.contentSections && typeof report.contentSections === "object" ? report.contentSections : {};
  const beca = esInformeBeca(report?.reportType);
  const definicion = beca ? SECCIONES_BECA : SECCIONES;

  const salen = [];
  for (const s of definicion) {
    const parrafos = parrafosDe(cs[s.key], s.lista);
    if (!parrafos.length) continue;
    salen.push({ n: salen.length + 1, key: s.key, label: s.label, lista: Boolean(s.lista), parrafos });
  }

  /*
   * El respaldo: un informe redactado con IA que todavía no se ha repartido.
   * Se imprime como apartado 1 con un titular genérico, porque el alternativo
   * es un documento con portada, índice y nada dentro. En la beca no aplica.
   */
  if (!salen.length && !beca) {
    const bruto = parrafosDe(report?.aiGenerated, false);
    if (bruto.length) {
      salen.push({ n: 1, key: "aiGenerated", label: "Informe", lista: false, parrafos: bruto });
    }
  }

  return salen;
}

/**
 * ¿Merece la pena imprimir un índice?
 *
 * Con dos apartados o menos, no: un índice de dos líneas ocupa una página
 * entera para decir lo que se ve pasando la hoja. El informe de beca tiene tres
 * apartados por definición y tampoco lo lleva — es un documento de dos folios
 * para una convocatoria, no una memoria.
 */
export function llevaIndice(report, apartados) {
  if (esInformeBeca(report?.reportType)) return false;
  return apartados.length >= 3;
}
