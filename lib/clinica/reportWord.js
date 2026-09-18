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
 * ── SÍ LLEVA LA MARCA DEL CENTRO (18/09/2026, AV-0172, Rodrigo) ──────────
 * Hasta hoy no llevaba ni logo ni colores, y era una decisión escrita: «esto no
 * es el documento que recibe la familia —ese es el PDF—, es el borrador para
 * seguir escribiendo; meterle la marca invitaría a mandarlo tal cual». Laura
 * Garrido volvió a pedirlo el 16/09 («el formato de word que me genera es sin
 * ningún tipo de formato, simplemente el texto sin logotipos ni diseño que sí
 * sale en pdf») y Rodrigo lo decidió el 18/09: el Word lleva la marca.
 *
 * Lleva el LOGO y los COLORES del centro, los mismos que el PDF
 * (`marcaInforme.js`, `lib/pdf/imagenLocal.js`) — así un centro con marca verde
 * tiene un Word verde sin que nadie toque código. Lo que sigue SIN llevar es el
 * pie legal y el anexo de registros literales del PDF: eso es del documento que
 * se entrega, y este se entrega solo si alguien decide entregarlo.
 *
 * El logo se lee de `public/` con `imagenLocal`, que NUNCA sale a la red (el
 * porqué, en ese fichero). Sin logo legible, sin dimensiones o si no es PNG, el
 * documento sale igual sin él: un informe no puede dejar de generarse porque
 * falte una imagen.
 *
 * Prueba en `scripts/_smoke-informe-word.mjs`.
 */

import { apartadosDelInforme } from "./apartadosInforme.js";
import { paletaDeInforme } from "./marcaInforme.js";
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

/** 914.400 EMU por pulgada, que es la unidad en la que Word mide las imágenes. */
const EMU_POR_CM = 914400 / 2.54;
/** Lo ancho que sale el logo en el papel. Cuatro centímetros es lo que ocupa en
 *  la portada del PDF y entra de sobra en el margen de 2,5 cm. */
const LOGO_CM = 4;

/**
 * El ancho y el alto de un PNG, leídos de su cabecera IHDR (bytes 16–24).
 *
 * Solo PNG a propósito: es lo que hay en `public/` y lo único cuyas dimensiones
 * se sacan de forma fiable en cuatro líneas. De un JPEG habría que recorrer sus
 * segmentos, y un Word sin logo es mejor que un Word con el logo deformado.
 * Devuelve null con cualquier otra cosa.
 */
export function dimensionesPng(buf) {
  if (!buf || typeof buf.readUInt32BE !== "function" || buf.length < 24) return null;
  const esPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (!esPng) return null;
  const ancho = buf.readUInt32BE(16);
  const alto = buf.readUInt32BE(20);
  if (!ancho || !alto) return null;
  return { ancho, alto };
}

/**
 * El párrafo con el logo incrustado, o "" si no se puede pintar.
 *
 * Es una imagen EN LÍNEA (`wp:inline`) y no flotante: en un documento que se va
 * a seguir escribiendo, una imagen anclada se despega en cuanto alguien añade
 * un párrafo encima.
 */
export function parrafoDelLogo(logo) {
  const dim = dimensionesPng(logo);
  if (!dim) return "";
  const cx = Math.round(LOGO_CM * EMU_POR_CM);
  const cy = Math.round((cx * dim.alto) / dim.ancho);
  const ext = `<wp:extent cx="${cx}" cy="${cy}"/>`;
  return (
    '<w:p><w:pPr><w:spacing w:after="160"/></w:pPr><w:r><w:drawing>' +
    '<wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
    ext +
    '<wp:docPr id="1" name="Logo del centro"/>' +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:nvPicPr><pic:cNvPr id="1" name="Logo del centro"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId3" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>' +
    '<a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
  );
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

  // El logo primero, como en la portada del PDF (AV-0172).
  const conLogo = parrafoDelLogo(datos.logo);
  if (conLogo) partes.push(conLogo);
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

/**
 * Los estilos, teñidos con la marca del centro (AV-0172). Los tonos salen de
 * `paletaDeInforme`, la misma que usa el PDF: sin marca guardada devuelve la
 * pizarra neutra y el documento sale sobrio, no roto.
 *
 * Word quiere los colores SIN almohadilla.
 */
export function estilosConMarca(brand) {
  const p = paletaDeInforme(brand);
  const hex = (c) => String(c ?? "").replace(/^#/, "").toUpperCase();
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    `<w:style w:type="paragraph" w:styleId="Centro"><w:name w:val="Centro"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:caps/><w:color w:val="${hex(p.principal)}"/><w:sz w:val="18"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Titulo"><w:name w:val="Titulo"/><w:pPr><w:spacing w:after="240"/><w:pBdr><w:bottom w:val="single" w:sz="12" w:space="6" w:color="${hex(p.acento)}"/></w:pBdr></w:pPr><w:rPr><w:b/><w:color w:val="${hex(p.oscuro)}"/><w:sz w:val="32"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Apartado"><w:name w:val="Apartado"/><w:pPr><w:spacing w:before="240" w:after="80"/><w:keepNext/></w:pPr><w:rPr><w:b/><w:color w:val="${hex(p.principal)}"/><w:sz w:val="24"/></w:rPr></w:style>` +
    "</w:styles>"
  );
}

/** Los de siempre, sin marca. Se queda para quien no pase el tenant. */
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
  // El logo solo entra si de verdad se puede pintar: si no, ni media, ni
  // relación, ni Default de png. Un ZIP que declara una parte que no está es
  // un documento que Word se niega a abrir.
  const logo = parrafoDelLogo(datos.logo) ? datos.logo : null;
  const tipos = logo
    ? CONTENT_TYPES.replace(
        '<Default Extension="xml" ContentType="application/xml"/>',
        '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'
      )
    : CONTENT_TYPES;
  const rels = logo
    ? RELS_DOC.replace(
        "</Relationships>",
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/></Relationships>'
      )
    : RELS_DOC;
  return [
    { nombre: "[Content_Types].xml", contenido: tipos },
    { nombre: "_rels/.rels", contenido: RELS },
    { nombre: "word/document.xml", contenido: documentoXml(report, tenant, { ...datos, logo }) },
    { nombre: "word/styles.xml", contenido: estilosConMarca(tenant?.settings?.brand) },
    { nombre: "word/numbering.xml", contenido: NUMERACION },
    { nombre: "word/_rels/document.xml.rels", contenido: rels },
    ...(logo ? [{ nombre: "word/media/logo.png", contenido: logo }] : []),
  ];
}

/** El nombre del fichero, con el mismo criterio que el del PDF. */
export function reportWordFilename(report, patientName) {
  const tipo = nombreDelInforme(report?.reportType);
  const quien = String(patientName ?? "").replace(/[\\/:*?"<>|]/g, "").trim();
  const fecha = report?.reportDate ? String(report.reportDate).slice(0, 10) : "";
  return [tipo, quien, fecha].filter(Boolean).join(" - ") + ".docx";
}
