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
import { APARTADOS_INFORME_BASE, apartadosPara } from "./plantillas.js";

/**
 * Orden de lectura del informe clínico cuando NADIE ha tocado nada: los siete
 * de siempre, con sus claves de siempre. `lista: true` → viñetas.
 *
 * Desde el 29/08/2026 esto es el RESPALDO, no la ley: la lista de verdad la da
 * `lib/clinica/plantillas.js` —la del propio informe si la guardó, la plantilla
 * del centro si no, y estos siete si tampoco—. Se conserva exportada porque es
 * la definición de «lo de siempre» y hay pruebas que se apoyan en ella.
 */
export const SECCIONES = APARTADOS_INFORME_BASE.map((a) => ({
  key: a.key,
  label: a.label,
  lista: a.tipo === "lista",
}));

const texto = (v) => (v == null ? "" : String(v).trim());

/**
 * El título de un apartado SIN el número que traiga delante («3. Antecedentes
 * personales» → «Antecedentes personales»). El documento numera él los
 * apartados —con el número grande al margen— y cuenta solo los que se
 * imprimen; si el título trae su propio número, salen dos y, en cuanto un
 * apartado se quede vacío, distintos («2 · 3. Antecedentes»). Lo trae la
 * plantilla de la entrevista inicial (`APARTADOS_ENTREVISTA_BASE`), que va
 * numerada porque así la escribió el centro, y lo puede traer cualquier
 * plantilla que escriba un centro. Solo para IMPRIMIR: la clave, la pantalla y
 * lo guardado no cambian.
 */
export function sinNumeroDelante(label) {
  return texto(label).replace(/^\d{1,2}\s*[.)·:-]\s+/, "") || texto(label);
}

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
export function apartadosDelInforme(report, tenant = null) {
  const cs = report?.contentSections && typeof report.contentSections === "object" ? report.contentSections : {};
  const beca = esInformeBeca(report?.reportType);
  /*
   * De dónde sale la lista (29/08/2026, Aumenta por Rodrigo: «estaría bien que
   * pudieran crear plantillas de informes ellas con los títulos que quieran»):
   * la BECA, de la convocatoria y de ningún sitio más; los demás, de
   * `plantillas.js`, que ya decide entre la foto del propio informe (con los
   * apartados sueltos que le añadieran), la plantilla del centro y los siete de
   * fábrica. Un informe escrito antes de esa fecha, y un centro que no ha tocado
   * nada, caen en los siete de siempre: el PDF sale idéntico.
   *
   * `tenant` es opcional y va el SEGUNDO a propósito: sin él se comporta como
   * antes de que existieran las plantillas, así que ningún llamador se rompe.
   */
  const definicion = beca
    ? SECCIONES_BECA.map((s) => ({ key: s.key, label: s.label, lista: s.tipo === "lista" }))
    : apartadosPara(cs, tenant, "informe").map((a) => ({ key: a.key, label: a.label, lista: a.tipo === "lista" }));

  const salen = [];
  for (const s of definicion) {
    const parrafos = parrafosDe(cs[s.key], s.lista);
    if (!parrafos.length) continue;
    salen.push({ n: salen.length + 1, key: s.key, label: sinNumeroDelante(s.label), lista: Boolean(s.lista), parrafos });
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
