import PDFDocument from "pdfkit";
import { registerPoppins } from "../pdf/fonts.js";
import { camposDe, bloquesDe } from "../clients/contratoFirma.js";

/**
 * contratoFirmadoPdf — la COPIA de quien firma (sprint tunutrilaura
 * 2026-08-04).
 *
 * (Fichero nuevo en /lib, regla #2: los tres generadores que hay son de otra
 * cosa —factura, menú semanal e informe clínico— y ninguno sabe de clausulado,
 * aceptaciones ni firma manuscrita. Lo que sí se reutiliza es
 * `lib/pdf/fonts.js`, para que todo lo que sale del CRM lleve la misma letra.)
 *
 * Se imprime el texto ÍNTEGRO de cada documento aceptado, no un resumen ni una
 * lista de títulos: quien firma tiene derecho a una copia de lo que aceptó, y
 * un PDF que dijera «aceptó el Anexo I» sin el Anexo I dentro no prueba nada.
 *
 * Lo que le da valor a esto no es el garabato —es una firma electrónica simple,
 * cualquiera puede dibujar una raya— sino el conjunto: los datos declarados, el
 * clausulado exacto que se aceptó, y la traza de cuándo, desde qué IP y con qué
 * navegador. Por eso la traza va IMPRESA en el documento y no solo en la base
 * de datos.
 */

const INK = "#1F2937";
const MUTED = "#6B7280";
const HAIRLINE = "#E5E7EB";

const PAGE = { size: "A4", margins: { top: 56, bottom: 64, left: 56, right: 56 } };

const FIRMA = { ancho: 190, alto: 70 };

const texto = (v) => (v == null ? "" : String(v).trim());

function fmtFecha(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
}

function fmtFechaHora(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Madrid",
  });
}

/** Las fechas de los datos declarados se enseñan en cristiano, no en ISO. */
function valorLegible(campo, valor) {
  const v = texto(valor);
  if (!v) return "";
  return campo.type === "date" ? fmtFecha(v) || v : v;
}

/** Nombre de fichero legible: es lo que verá la paciente al descargarlo. */
export function contratoPdfFilename(titulo, nombreFirmante, fecha) {
  const limpio = (s) => texto(s).replace(/[\\/:*?"<>|]/g, "").trim();
  const dia = fecha ? new Date(fecha).toISOString().slice(0, 10) : "";
  return [limpio(titulo) || "Contrato firmado", limpio(nombreFirmante), dia].filter(Boolean).join(" - ") + ".pdf";
}

const anchoUtil = (doc) => doc.page.width - doc.page.margins.left - doc.page.margins.right;

/**
 * Pie fijo en TODAS las páginas.
 *
 * El truco del margen inferior a cero es el de siempre con pdfkit: escribir por
 * debajo del margen dispararía un salto de página, y un salto de página dispara
 * otro pie, y así hasta que se acaba la memoria.
 *
 * ⚠️ EL TRUCO NO BASTABA, Y LO DE ARRIBA ERA UNA PROMESA FALSA (21/08/2026).
 * Poner el margen a cero deja escribir hasta el borde de la hoja, pero NO más
 * allá: un pie que no quepa en esa franja salta de página igual, y ese salto
 * vuelve a llamar aquí. Medido antes del arreglo, con el generador de verdad:
 * un pie de OCHO líneas cortas —quince caracteres en total— acababa en
 * `RangeError: Maximum call stack size exceeded` y SIN PDF. `lineBreak: false`
 * no salvaba, porque no desactiva los saltos de línea explícitos.
 *
 * No era teórico: `footer` es VARCHAR(300), y un pie de cuatro renglones
 * —nombre, calle, CIF, teléfono— cabe de sobra. Y el archivado del contrato se
 * llama con `.catch(() => null)`, así que la familia firmaba, la firma se
 * guardaba, y se quedaba sin su copia sin que nadie se enterara.
 *
 * Dos cierres, porque uno solo se puede volver a abrir:
 *   1. `height` + `ellipsis`: pdfkit RECORTA lo que no cabe en vez de paginar.
 *      Un pie demasiado largo sale cortado con puntos suspensivos, que es un
 *      defecto que se ve, en vez de un documento que no existe.
 *   2. Un cerrojo de reentrada: si algún día otra cosa hiciera saltar de página
 *      desde aquí dentro, el segundo pie no se pinta y no hay recursión. Es la
 *      red por si el cálculo de arriba se queda corto.
 */
function pintarPie(doc, F, pie) {
  if (!pie || doc.__pintandoPie) return;
  doc.__pintandoPie = true;
  const pagina = doc.page;
  const guardado = doc.y;
  const margenAbajo = pagina.margins.bottom;
  const arriba = pagina.height - margenAbajo + 22;
  // Lo que de verdad queda entre donde empieza el pie y el borde de la hoja.
  const disponible = Math.max(0, pagina.height - arriba);
  pagina.margins.bottom = 0;
  try {
    doc
      .font(F.regular)
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(pie, pagina.margins.left, arriba, {
        width: anchoUtil(doc),
        align: "center",
        lineBreak: false,
        height: disponible,
        ellipsis: true,
      });
  } finally {
    // Sobre `pagina`, no sobre `doc.page`: si algo hubiera cambiado de hoja, el
    // margen había que devolverlo en la que se tocó.
    pagina.margins.bottom = margenAbajo;
    doc.y = guardado;
    doc.__pintandoPie = false;
  }
}

/** Salta de página si no quedan `alto` puntos: evita firmas partidas en dos. */
function reservar(doc, alto) {
  const limite = doc.page.height - doc.page.margins.bottom;
  if (doc.y + alto > limite) doc.addPage();
}

function cabecera(doc, F, { tenantName, brand, titulo }) {
  const acento = brand?.primaryColor || "#1B3A2D";
  doc.font(F.medium).fontSize(10).fillColor(MUTED).text(texto(tenantName) || "Documento firmado");
  doc.moveDown(0.35);
  doc.font(F.bold).fontSize(19).fillColor(INK).text(texto(titulo));
  doc.moveDown(0.5);
  const y = doc.y;
  doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y)
    .lineWidth(2).strokeColor(acento).stroke();
  doc.moveDown(1);
}

/** Los datos declarados, agrupados como se pidieron en pantalla. */
function seccionDatos(doc, F, campos, datos) {
  let grupoActual;

  for (const campo of campos) {
    const valor = valorLegible(campo, datos?.[campo.key]);
    if (!valor) continue;

    if (campo.group && campo.group !== grupoActual) {
      grupoActual = campo.group;
      reservar(doc, 40);
      doc.moveDown(0.3);
      doc.font(F.bold).fontSize(11).fillColor(INK).text(grupoActual);
      doc.moveDown(0.4);
    }

    reservar(doc, 34);
    doc.font(F.medium).fontSize(8.5).fillColor(MUTED).text(campo.label.toUpperCase());
    doc.font(F.regular).fontSize(11).fillColor(INK).text(valor);
    doc.moveDown(0.4);
  }

  doc.moveDown(0.3);
  const y = doc.y;
  doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y)
    .lineWidth(0.5).strokeColor(HAIRLINE).stroke();
  doc.moveDown(1);
}

/** Un documento del paquete: su texto entero y la constancia de aceptación. */
function seccionBloque(doc, F, bloque, aceptacion) {
  reservar(doc, 70);
  doc.font(F.bold).fontSize(13).fillColor(INK).text(bloque.title);
  doc.moveDown(0.5);

  if (bloque.body) {
    doc.font(F.regular).fontSize(9.5).fillColor(INK).text(bloque.body, { align: "justify", lineGap: 1.5 });
    doc.moveDown(0.5);
  }

  reservar(doc, 26);
  doc.font(F.medium).fontSize(9).fillColor(MUTED)
    .text(
      aceptacion
        ? `Aceptado el ${fmtFechaHora(aceptacion.acceptedAt)}`
        : "Aceptado al firmar este documento"
    );
  doc.moveDown(1.1);
}

/** Recuadro de firma: imagen + a quién pertenece. */
function recuadroFirma(doc, F, { etiqueta, imagen, nombre, documento, lugar, fecha, x, ancho }) {
  const izquierda = x ?? doc.page.margins.left;
  const w = ancho ?? Math.min(FIRMA.ancho + 60, anchoUtil(doc));
  const arriba = doc.y;

  doc.font(F.medium).fontSize(8.5).fillColor(MUTED).text(etiqueta.toUpperCase(), izquierda, arriba, { width: w });

  const yImagen = doc.y + 4;
  if (imagen) {
    try {
      doc.image(imagen, izquierda, yImagen, { fit: [FIRMA.ancho, FIRMA.alto], align: "left" });
    } catch {
      // Un PNG corrupto no puede tumbar el documento: la firma vale por la
      // traza, no por el dibujo. Se deja el hueco y sigue.
    }
  }

  const yLinea = yImagen + FIRMA.alto + 4;
  doc.moveTo(izquierda, yLinea).lineTo(izquierda + FIRMA.ancho, yLinea)
    .lineWidth(0.5).strokeColor(HAIRLINE).stroke();

  doc.y = yLinea + 6;
  doc.font(F.regular).fontSize(10).fillColor(INK).text(texto(nombre) || "—", izquierda, doc.y, { width: w });
  if (documento) doc.font(F.regular).fontSize(9).fillColor(MUTED).text(`DNI/NIE: ${documento}`, { width: w });
  if (lugar || fecha) {
    doc.font(F.regular).fontSize(9).fillColor(MUTED)
      .text([lugar ? `En ${lugar}` : null, fecha ? `a ${fmtFecha(fecha)}` : null].filter(Boolean).join(", "), { width: w });
  }
}

/** La traza: es lo que convierte un garabato en una firma que se sostiene. */
function seccionTraza(doc, F, { firmadoEl, ip, userAgent, plantillaKey, version }) {
  reservar(doc, 90);
  doc.moveDown(0.6);
  const y = doc.y;
  doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y)
    .lineWidth(0.5).strokeColor(HAIRLINE).stroke();
  doc.moveDown(0.7);

  doc.font(F.medium).fontSize(8.5).fillColor(MUTED).text("CONSTANCIA DE LA FIRMA ELECTRÓNICA");
  doc.moveDown(0.35);

  const lineas = [
    ["Fecha y hora", fmtFechaHora(firmadoEl)],
    ["Dirección IP", texto(ip) || "no registrada"],
    ["Navegador", texto(userAgent) || "no registrado"],
    ["Documento", version ? `${plantillaKey} (versión ${version})` : texto(plantillaKey)],
  ];
  doc.font(F.regular).fontSize(8).fillColor(MUTED);
  for (const [etiqueta, valor] of lineas) {
    if (!valor) continue;
    doc.text(`${etiqueta}: ${valor}`, { width: anchoUtil(doc) });
  }
}

/**
 * Devuelve el Buffer del PDF firmado.
 *
 * @param plantilla    fila de ContractTemplate (o su JSON)
 * @param firma        { signerName, signerData, acceptances, signedAt, ip, userAgent }
 * @param imagenFirma  Buffer PNG de la firma dibujada
 * @param imagenSegunda Buffer PNG de la segunda firma (asentimiento), si la hay
 */
export async function buildContratoFirmadoPdf({
  plantilla,
  firma,
  imagenFirma,
  imagenSegunda = null,
  tenantName,
  brand,
}) {
  const campos = camposDe(plantilla);
  const bloques = bloquesDe(plantilla);
  const datos = firma?.signerData && typeof firma.signerData === "object" ? firma.signerData : {};
  const aceptadas = new Map(
    (Array.isArray(firma?.acceptances) ? firma.acceptances : []).map((a) => [texto(a?.id), a])
  );
  const pie = texto(plantilla?.footer);

  // El campo que lleve el DNI y el de la localidad no tienen nombre fijo: se
  // buscan por TIPO y por convención de clave, para que una plantilla nueva no
  // tenga que llamarlos igual que la de Laura.
  const campoDni = campos.find((c) => c.type === "dni");
  const documento = campoDni ? texto(datos[campoDni.key]) : "";
  const lugar = texto(datos.lugarFirma ?? datos.localidad ?? "");
  const fechaFirmaDeclarada = texto(datos.fechaFirma ?? "") || firma?.signedAt;

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument(PAGE);
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const F = registerPoppins(doc);
      doc.on("pageAdded", () => pintarPie(doc, F, pie));

      cabecera(doc, F, { tenantName, brand, titulo: plantilla?.title || "Contrato firmado" });
      pintarPie(doc, F, pie); // la primera página no dispara `pageAdded`

      seccionDatos(doc, F, campos, datos);

      for (const bloque of bloques) {
        // Solo lo aceptado. Un bloque opcional que no se marcó no puede
        // aparecer en el documento como si se hubiera aceptado.
        if (!aceptadas.has(bloque.id)) continue;
        seccionBloque(doc, F, bloque, aceptadas.get(bloque.id));
      }

      reservar(doc, FIRMA.alto + 110);
      doc.moveDown(0.5);
      recuadroFirma(doc, F, {
        etiqueta: "Firma",
        imagen: imagenFirma,
        nombre: firma?.signerName,
        documento,
        lugar,
        fecha: fechaFirmaDeclarada,
      });

      // Sin dibujo: hay que decir POR QUÉ, o el recuadro vacío parece un fallo
      // de impresión. Una persona menor puede aceptar sin firmar; lo que da
      // valor al documento es la traza de abajo y el consentimiento del tutor.
      if (!imagenFirma) {
        doc.font(F.regular).fontSize(8.5).fillColor(MUTED).text(
          "Persona menor de edad: acepta el documento sin firma manuscrita. La autorización la presta su " +
            "madre, padre o tutor legal en el consentimiento parental.",
          { width: anchoUtil(doc) }
        );
      }

      if (imagenSegunda && plantilla?.secondSignatureLabel) {
        doc.moveDown(1.2);
        reservar(doc, FIRMA.alto + 80);
        recuadroFirma(doc, F, {
          etiqueta: plantilla.secondSignatureLabel,
          imagen: imagenSegunda,
          nombre: texto(datos.menorNombre) || "",
        });
      }

      seccionTraza(doc, F, {
        firmadoEl: firma?.signedAt,
        ip: firma?.ip,
        userAgent: firma?.userAgent,
        plantillaKey: plantilla?.title || plantilla?.key,
        version: firma?.templateVersion ?? plantilla?.version,
      });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
