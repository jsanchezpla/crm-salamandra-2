/**
 * lib/clinica/reportWord.js — el informe clínico en documento EDITABLE
 * (09/09/2026, AV-0099).
 *
 * ── DE QUÉ PETICIÓN NACE, Y POR QUÉ NO ES UN CAPRICHO ──────────────────────
 * Laura Garrido (Aumenta): pide «poder sacar el informe en documento editable»
 * en vez de solo en PDF, «para no tener que pasar por una web de conversión con
 * datos personales dentro».
 *
 * Esa segunda mitad es la razón de peso. Hoy, para retocar un informe fuera del
 * CRM, alguien está subiendo un PDF con el nombre, la edad y el diagnóstico de
 * un menor a un conversor gratuito de internet. Eso es una cesión de datos de
 * salud a un tercero del que no sabemos nada, hecha por una profesional que
 * solo quería cambiar un párrafo. No se arregla con una advertencia: se arregla
 * dándole el .docx.
 *
 * ── ES UN .DOCX DE VERDAD, NO UN HTML DISFRAZADO ───────────────────────────
 * El truco fácil sería servir HTML con extensión `.doc`: Word lo abre. Pero al
 * guardar avisa de que el formato no coincide, y en Google Docs o en un Mac sin
 * Word el fichero es un HTML raro. Un .docx es un ZIP con cuatro XML dentro, y
 * armarlo a mano no necesita ninguna librería nueva: `archiver` ya está en el
 * proyecto para el ZIP de facturas. Así el fichero se abre igual en Word, en
 * LibreOffice, en Pages y en Drive.
 *
 * Este fichero construye el XML (puro, sin dependencias). Empaquetarlo es
 * `ficherosDelDocx()` + el ZIP, que hace la ruta.
 *
 * ── LOS APARTADOS SON LOS MISMOS QUE LOS DEL PDF ───────────────────────────
 * Salen de `apartadosDelInforme`, igual que el PDF. No hay una segunda lista:
 * si mañana el centro añade un apartado a su plantilla, aparece en los dos
 * documentos el mismo día. Un Word que dijera algo distinto del PDF del mismo
 * informe sería peor que no tener Word.
 *
 * ── LO QUE NO LLEVA, A PROPÓSITO ───────────────────────────────────────────
 * Ni logo, ni colores de marca, ni el anexo de registros literales. Esto no es
 * el documento que recibe la familia —ese es y sigue siendo el PDF, con su
 * portada y su pie legal—: es el borrador para seguir escribiendo. Meterle la
 * marca invitaría a mandarlo tal cual, y un .docx se reenvía y se edita sin que
 * quede rastro de quién lo tocó.
 *
 * Prueba en `scripts/_smoke-informe-word.mjs`.
 */

import { apartadosDelInforme } from "./apartadosInforme.js";
import { nombreDelInforme } from "./serialize.js";

/** XML no perdona: `&`, `<` y `>` fuera, y los caracteres de control también. */
export function escaparXml(t) {
  return String(t ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Un párrafo de WordprocessingML.
 *
 * `estilo` es uno de los que declara `word/styles.xml`; sin él, texto normal.
 * `negrita` se pone en la tirada y no en el estilo porque los rótulos sueltos
 * («Paciente:») no merecen un estilo propio.
 */
function parrafo(texto, { estilo = null, negrita = false, vineta = false } = {}) {
  const props = [];
  if (estilo) props.push(`<w:pStyle w:val="${estilo}"/>`);
  if (vineta) props.push('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>');
  const pPr = props.length ? `<w:pPr>${props.join("")}</w:pPr>` : "";
  const rPr = negrita ? "<w:rPr><w:b/></w:rPr>" : "";
  const t = escaparXml(texto);
  if (!t) return `<w:p>${pPr}</w:p>`;
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
}

/** «2026-09-09» → «9 de septiembre de 2026». Sin Intl: la prueba no depende del locale. */
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export function fechaLarga(valor) {
  const s = String(valor ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  const [a, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12) return "";
  return `${d} de ${MESES[m - 1]} de ${a}`;
}

/**
 * El cuerpo del documento: título, ficha de cabecera, apartados y firma.
 *
 * @param report      el informe (con `contentSections`)
 * @param tenant      el tenant, para que los apartados sean los de SU plantilla
 * @param datos       nombre del paciente, del centro y de quien firma
 */
export function cuerpoDelWord(report, tenant, datos = {}) {
  const partes = [];
  const titulo = nombreDelInforme(report?.reportType);

  if (datos.tenantName) partes.push(parrafo(datos.tenantName, { estilo: "Centro" }));
  partes.push(parrafo(titulo, { estilo: "Titulo" }));

  // La ficha de cabecera. Solo lo que hay: una línea «Fecha:» vacía en un
  // documento que alguien va a imprimir es peor que no ponerla.
  const ficha = [
    ["Paciente", datos.patientName],
    ["Fecha del informe", fechaLarga(report?.reportDate)],
    ["Profesional", datos.therapistName],
    ["Puesto", datos.therapistPosition],
    ["Titulación", datos.therapistQualification],
    ["Nº de colegiada/o", datos.therapistCollegiate],
  ].filter(([, v]) => String(v ?? "").trim());
  for (const [rotulo, valor] of ficha) {
    partes.push(
      `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escaparXml(rotulo)}: </w:t></w:r>` +
        `<w:r><w:t xml:space="preserve">${escaparXml(valor)}</w:t></w:r></w:p>`
    );
  }
  partes.push(parrafo(""));

  // Los apartados, EXACTAMENTE los mismos que imprime el PDF.
  const apartados = apartadosDelInforme(report, tenant);
  for (const ap of apartados) {
    partes.push(parrafo(ap.label, { estilo: "Apartado" }));
    for (const p of ap.parrafos) partes.push(parrafo(p, { vineta: ap.lista }));
    partes.push(parrafo(""));
  }
  if (!apartados.length) {
    partes.push(parrafo("Este informe todavía no tiene ningún apartado escrito."));
  }

  // La firma, al final y sin línea de puntos: la pone quien lo imprima.
  if (datos.therapistName) {
    partes.push(parrafo(""));
    partes.push(parrafo(datos.therapistName, { negrita: true }));
    const bajoFirma = [datos.therapistPosition, datos.therapistQualification, datos.therapistCollegiate && `Col. ${datos.therapistCollegiate}`]
      .filter(Boolean)
      .join(" · ");
    if (bajoFirma) partes.push(parrafo(bajoFirma));
  }

  return partes.join("");
}

/** `word/document.xml` entero. */
export function documentoXml(report, tenant, datos = {}) {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    "<w:body>" +
    cuerpoDelWord(report, tenant, datos) +
    // La sección: A4 con márgenes de 2,5 cm (en vigésimas de punto).
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>' +
    "</w:body></w:document>"
  );
}

const ESTILOS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  // Por defecto para todo el documento: 11 pt (media = 22) y algo de aire.
  '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>' +
  '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:styleId="Centro"><w:name w:val="Centro"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:caps/><w:color w:val="666666"/><w:sz w:val="18"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Titulo"><w:name w:val="Titulo"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Apartado"><w:name w:val="Apartado"/><w:pPr><w:spacing w:before="240" w:after="80"/><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>' +
  "</w:styles>";

const NUMERACION =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/>' +
  '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
  "</Types>";

const RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  "</Relationships>";

const RELS_DOC =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
  "</Relationships>";

/**
 * Los cinco ficheros que van dentro del ZIP, en el orden en que hay que
 * meterlos. `[Content_Types].xml` PRIMERO: es lo que mira Word para saber que
 * esto es un documento y no un ZIP cualquiera.
 */
export function ficherosDelDocx(report, tenant, datos = {}) {
  return [
    { nombre: "[Content_Types].xml", contenido: CONTENT_TYPES },
    { nombre: "_rels/.rels", contenido: RELS },
    { nombre: "word/document.xml", contenido: documentoXml(report, tenant, datos) },
    { nombre: "word/styles.xml", contenido: ESTILOS },
    { nombre: "word/numbering.xml", contenido: NUMERACION },
    { nombre: "word/_rels/document.xml.rels", contenido: RELS_DOC },
  ];
}

/** El nombre del fichero, con el mismo criterio que el del PDF. */
export function reportWordFilename(report, patientName) {
  const tipo = nombreDelInforme(report?.reportType);
  const quien = String(patientName ?? "").replace(/[\\/:*?"<>|]/g, "").trim();
  const fecha = report?.reportDate ? String(report.reportDate).slice(0, 10) : "";
  return [tipo, quien, fecha].filter(Boolean).join(" - ") + ".docx";
}
