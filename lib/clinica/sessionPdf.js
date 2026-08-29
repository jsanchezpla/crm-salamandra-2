import PDFDocument from "pdfkit";
import { registerPoppins } from "../pdf/fonts.js";
import { paletaDeInforme } from "./marcaInforme.js";
import { datosDelCentro, lineaDeSede } from "../tenant/datosCentro.js";
import { apartadosPara, valoresDeSesion } from "./plantillas.js";

/**
 * PDF del REGISTRO DE SESIÓN (29/08/2026, Rodrigo: «necesito que se puedan
 * generar PDF también de los Registros de Sesiones»).
 *
 * Hasta hoy el único documento que salía en PDF era el informe clínico. El
 * registro de sesión —que es lo que el centro escribe 22.045 veces— solo se
 * podía leer dentro del CRM o de refilón, en el anexo literal de un informe.
 *
 * ── POR QUÉ NO ES EL MISMO GENERADOR QUE EL INFORME ────────────────────────
 * (Fichero nuevo en /lib, regla #2.) El informe rediseñado el 28/08 es un
 * DOCUMENTO FORMAL: portada a sangre, índice en la página 2, apartados
 * numerados, firma con nº de colegiada y el isotipo cerrando. Es lo que una
 * familia presenta en el colegio o adjunta a la beca. Un registro de sesión es
 * lo contrario: una hoja de trabajo del equipo, de la que se sacan una o
 * cincuenta. Ponerle portada e índice a una hoja sería un chiste, y meter un
 * `if` por tipo dentro de `reportPdf.js` habría dejado un fichero haciendo dos
 * cosas a medias.
 *
 * Lo que SÍ se comparte es lo que hace que los dos parezcan del mismo centro:
 * la paleta de la marca (`marcaInforme.js`), los datos del centro
 * (`lib/tenant/datosCentro.js`) y la lista de apartados (`plantillas.js`).
 *
 * ── QUÉ NO SALE, Y NO ES UN OLVIDO ─────────────────────────────────────────
 * Ni la preparación (`prepText`) ni sus adjuntos ni las notas internas ni la
 * transcripción del audio. Son material del equipo: la regla del módulo es que
 * no salen del CRM, y un PDF es justo la forma de que salgan. Se imprimen los
 * apartados del registro —los de su plantilla y los sueltos que le añadieran— y
 * la devolución de la familia.
 */

const MARGEN = { top: 62, bottom: 76, left: 62, right: 62 };

const texto = (v) => (v == null ? "" : String(v).trim());

function fmtFechaHora(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleString("es-ES", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const util = (doc) => doc.page.width - doc.page.margins.left - doc.page.margins.right;

function filete(doc, y, color, grosor = 0.75, desde = null, hasta = null) {
  const x1 = desde ?? doc.page.margins.left;
  const x2 = hasta ?? doc.page.width - doc.page.margins.right;
  doc.save().moveTo(x1, y).lineTo(x2, y).lineWidth(grosor).strokeColor(color).stroke().restore();
}

/** Nombre de fichero legible: «Registro de sesión - Nombre - 2026-08-29.pdf». */
export function sessionPdfFilename(session, patientName) {
  const fecha = session?.sessionDate ? new Date(session.sessionDate) : null;
  const dia = fecha && !Number.isNaN(fecha.getTime()) ? fecha.toISOString().slice(0, 10) : "";
  const limpio = (v) => texto(v).replace(/[\\/:*?"<>|]/g, "").trim();
  return `${["Registro de sesión", limpio(patientName), dia].filter(Boolean).join(" - ")}.pdf`;
}

/** Cabecera: el centro, el título del documento y la regla de su color. */
function cabecera(doc, F, { centro, marca }) {
  doc.font(F.medium).fontSize(9.5).fillColor(marca.suave).text(centro.nombre || "Registro de sesión");
  doc.moveDown(0.3);
  doc.font(F.bold).fontSize(19).fillColor(marca.oscuro).text("Registro de sesión");
  doc.moveDown(0.55);
  filete(doc, doc.y, marca.acento, 1.6, doc.page.margins.left, doc.page.margins.left + 54);
  doc.moveDown(1.1);
}

/** Rótulo + valor. Las filas sin valor no se imprimen, ni su rótulo. */
function fichaDatos(doc, F, filas, marca) {
  for (const [etiqueta, valor] of filas) {
    if (!valor) continue;
    doc.font(F.medium).fontSize(8).fillColor(marca.suave).text(etiqueta.toUpperCase(), { characterSpacing: 0.6 });
    doc.font(F.regular).fontSize(10.5).fillColor(marca.tinta).text(valor);
    doc.moveDown(0.4);
  }
  doc.moveDown(0.3);
  filete(doc, doc.y, marca.filete, 0.5);
  doc.moveDown(0.9);
}

/**
 * UN APARTADO: su título y su cuerpo. Es la pieza que hace que una plantilla
 * escrita por el centro salga con el diseño de la casa sin que nadie toque el
 * generador — el PDF solo tiene que distinguir título de cuerpo, que es lo que
 * se pidió (Rodrigo, 28/08/2026).
 */
function apartado(doc, F, { label, parrafos, lista }, marca) {
  const x = doc.page.margins.left;
  // Un titular no se queda solo al final de la hoja con su texto en la
  // siguiente: si no caben unas líneas debajo, se pasa entero.
  if (doc.y + 72 > doc.page.height - doc.page.margins.bottom) doc.addPage();
  doc.font(F.bold).fontSize(11.5).fillColor(marca.oscuro).text(label, x, doc.y, { width: util(doc) });
  doc.moveDown(0.25);
  filete(doc, doc.y, marca.acento, 1, x, x + 34);
  doc.moveDown(0.6);
  doc.x = x;

  doc.font(F.regular).fontSize(10.2).fillColor(marca.tinta);
  if (lista) {
    for (const t of parrafos) {
      const y = doc.y;
      doc.fillColor(marca.principal).text("—", x, y, { width: 12, lineBreak: false });
      doc.fillColor(marca.tinta).text(t, x + 16, y, { width: util(doc) - 16, lineGap: 2 });
      doc.moveDown(0.25);
      doc.x = x;
    }
  } else {
    doc.text(parrafos.join("\n\n"), x, doc.y, { width: util(doc), lineGap: 2.4, paragraphGap: 6 });
  }
  doc.moveDown(0.9);
  doc.x = x;
}

/**
 * Pie con la identidad del centro y el número de página, igual que el del
 * informe. Se salta el bloque entero si el centro no tiene datos puestos: en
 * producción, hoy, no los tiene nadie.
 */
function pieYNumeros(doc, F, { centro, marca }) {
  const rango = doc.bufferedPageRange();
  for (let i = rango.start; i < rango.start + rango.count; i++) {
    doc.switchToPage(i);
    // Escribir bajo el margen inferior haría que pdfkit añadiera página tras
    // página. Se anulan mientras se pinta el pie (mismo apaño que reportPdf.js).
    const margenes = { ...doc.page.margins };
    doc.page.margins.top = 0;
    doc.page.margins.bottom = 0;

    const izq = 50;
    const ancho = doc.page.width - 100;
    const yPie = doc.page.height - 58;

    doc.save();
    filete(doc, yPie - 8, marca.filete, 0.5, izq, izq + ancho);
    if (centro.hayPie) {
      const identidad = [centro.razonSocial || centro.nombre, centro.cif ? `CIF: ${centro.cif}` : ""]
        .filter(Boolean)
        .join(" — ");
      doc.font(F.medium).fontSize(6.6).fillColor(marca.suave).text(identidad, izq, yPie, { width: ancho, align: "center" });
      doc.font(F.regular).fontSize(6.2).fillColor(marca.suave);
      for (const sede of centro.sedes) {
        const linea = lineaDeSede(sede);
        if (linea) doc.text(linea, izq, doc.y, { width: ancho, align: "center" });
      }
    } else {
      doc.y = yPie;
    }
    if (rango.count > 1) {
      doc.font(F.regular).fontSize(7.5).fillColor(marca.suave);
      doc.text(String(i - rango.start + 1), izq, doc.page.height - 40, { width: ancho, align: "right" });
    }
    doc.restore();
    doc.page.margins = margenes;
  }
}

/**
 * Devuelve el Buffer del PDF de un registro de sesión.
 *
 * @param session       fila de ClinicSession (o su JSON)
 * @param patientName   nombre del paciente, ya compuesto
 * @param therapistName quien dio la sesión, si consta (en el histórico
 *   importado de Aumenta hay 4.045 sesiones sin firmar: la fila se cae sola)
 * @param tenantName    respaldo del nombre del centro
 * @param brand         `settings.brand`: de ahí sale la paleta
 * @param tenant        el tenant entero: de ahí salen `settings.centro` y las
 *   plantillas del centro, a las que se cae cuando el registro no trae su
 *   propia foto de apartados — que es todo lo escrito antes del 29/08/2026
 */
export async function buildSessionPdfBuffer({ session, patientName, therapistName, tenantName, brand, tenant = null }) {
  const s = session?.toJSON ? session.toJSON() : session;
  if (!s) return Promise.reject(new Error("Sin sesión que imprimir"));

  const marca = paletaDeInforme(brand);
  const centro = datosDelCentro(tenant, { nombrePorDefecto: tenantName });
  const bolsa = valoresDeSesion(s);
  const devolucion = texto(s.parentFeedback);

  const apartados = [];
  for (const a of apartadosPara(s.contentSections, tenant, "registro")) {
    const v = bolsa[a.key];
    const parrafos =
      a.tipo === "lista"
        ? (Array.isArray(v) ? v.map(texto).filter(Boolean) : texto(v) ? [texto(v)] : [])
        : texto(v)
          ? texto(v).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
          : [];
    if (!parrafos.length) continue;
    apartados.push({ label: a.label, lista: a.tipo === "lista", parrafos });
  }
  // La devolución de la familia es la parte 3 del registro, no un apartado de
  // plantilla: va siempre al final y con su rótulo de siempre.
  if (devolucion) {
    apartados.push({ label: "Devolución de la familia", lista: false, parrafos: [devolucion] });
  }

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margins: MARGEN, bufferPages: true });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const F = registerPoppins(doc);
      cabecera(doc, F, { centro, marca });
      fichaDatos(
        doc,
        F,
        [
          ["Paciente", texto(patientName)],
          ["Fecha de la sesión", fmtFechaHora(s.sessionDate)],
          ["Profesional", texto(therapistName)],
          ["Duración", s.duration ? `${s.duration} minutos` : ""],
        ],
        marca
      );

      if (apartados.length) {
        for (const a of apartados) apartado(doc, F, a, marca);
      } else {
        doc.font(F.italic).fontSize(10.5).fillColor(marca.suave)
          .text("Este registro todavía no tiene contenido escrito.");
      }

      pieYNumeros(doc, F, { centro, marca });
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
