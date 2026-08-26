import PDFDocument from "pdfkit";
import { registerPoppins } from "../pdf/fonts.js";
import { REPORT_TYPE_LABEL } from "./serialize.js";
import { referralSpecialtyLabelOf } from "./derivaciones.js";
import { esInformeBeca, denominacionesBeca, SECCIONES_BECA } from "./beca.js";

/**
 * PDF del informe clínico — lo que RECIBE la familia (sprint Aumenta 2026-07,
 * punto 3.2: «Enviar al paciente» en vez de «Marcar como entregado»).
 *
 * (Fichero nuevo en /lib, regla #2: los dos generadores que había son de otra
 * cosa —factura y menú semanal— y ninguno sabe de secciones de informe. Lo que
 * sí se reutiliza es `lib/pdf/fonts.js`, para que todo lo que sale del CRM
 * lleve la misma tipografía.)
 *
 * El informe se compone de secciones fijas (`ClinicalReport.contentSections`),
 * unas de texto libre y otras de lista. Se imprimen SOLO las que tienen algo:
 * un informe de derivación no tiene «logros», y dejar el titular vacío parece
 * un error de la clínica.
 *
 * Sin membrete ni pie de página: el documento lo abre una familia en el móvil,
 * no se archiva en un expediente en papel.
 */

const INK = "#1F2937";
const MUTED = "#6B7280";
const HAIRLINE = "#E5E7EB";

const PAGE = { size: "A4", margins: { top: 56, bottom: 56, left: 56, right: 56 } };

// Orden de lectura del informe. `lista: true` → viñetas.
const SECCIONES = [
  { key: "motiveOfIntervention", label: "Motivo de intervención", lista: false },
  { key: "objectives", label: "Objetivos", lista: true },
  { key: "evolution", label: "Evolución", lista: true },
  { key: "achievements", label: "Logros", lista: true },
  { key: "persistentDifficulties", label: "Dificultades que persisten", lista: true },
  { key: "recommendations", label: "Recomendaciones", lista: true },
  { key: "continuityProposal", label: "Propuesta de continuidad", lista: false },
];

function fmtFecha(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
}

const texto = (v) => (v == null ? "" : String(v).trim());
const lista = (v) => (Array.isArray(v) ? v.map(texto).filter(Boolean) : texto(v) ? [texto(v)] : []);

/** Nombre de fichero legible: es lo que verá la familia en su portal. */
export function reportPdfFilename(report, patientName) {
  const tipo = REPORT_TYPE_LABEL[report.reportType] ?? "Informe";
  const quien = texto(patientName).replace(/[\\/:*?"<>|]/g, "").trim();
  const fecha = report.reportDate ? String(report.reportDate).slice(0, 10) : "";
  return [tipo, quien, fecha].filter(Boolean).join(" - ") + ".pdf";
}

function cabecera(doc, F, { tenantName, brand, tipoLabel, subtitulos = [] }) {
  const acento = brand?.primaryColor || "#1B3A2D";
  doc.font(F.medium).fontSize(10).fillColor(MUTED).text(texto(tenantName) || "Informe clínico");
  doc.moveDown(0.35);
  doc.font(F.bold).fontSize(20).fillColor(INK).text(tipoLabel);
  // El informe de beca lleva aquí el servicio con su NOMBRE OFICIAL de la
  // convocatoria («Reeducación del lenguaje», «Reeducación pedagógica y
  // habilidades sociales»), nunca el del centro (lib/clinica/beca.js).
  for (const s of subtitulos) {
    doc.moveDown(0.2);
    doc.font(F.medium).fontSize(12).fillColor(INK).text(s);
  }
  doc.moveDown(0.5);
  const y = doc.y;
  doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y)
    .lineWidth(2).strokeColor(acento).stroke();
  doc.moveDown(1);
}

function fichaDatos(doc, F, filas) {
  for (const [etiqueta, valor] of filas) {
    if (!valor) continue;
    doc.font(F.medium).fontSize(9).fillColor(MUTED).text(etiqueta.toUpperCase(), { continued: false });
    doc.font(F.regular).fontSize(11).fillColor(INK).text(valor);
    doc.moveDown(0.4);
  }
  doc.moveDown(0.4);
  const y = doc.y;
  doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y)
    .lineWidth(0.5).strokeColor(HAIRLINE).stroke();
  doc.moveDown(1);
}

function seccion(doc, F, label, parrafos, esLista) {
  doc.font(F.bold).fontSize(12).fillColor(INK).text(label);
  doc.moveDown(0.35);
  doc.font(F.regular).fontSize(11).fillColor(INK);
  if (esLista) {
    for (const p of parrafos) {
      doc.text(`•  ${p}`, { align: "left", lineGap: 2, indent: 4 });
      doc.moveDown(0.25);
    }
  } else {
    doc.text(parrafos.join("\n\n"), { align: "left", lineGap: 2 });
  }
  doc.moveDown(0.9);
}

/**
 * Bloque de firma del informe de beca: hueco para firmar a mano, la raya y el
 * nombre de quien firma. Si no cabe en lo que queda de página, se pasa a la
 * siguiente en bloque — una firma partida en dos páginas no la acepta nadie.
 */
function firma(doc, F, therapistName) {
  const ALTO_FIRMA = 110;
  if (doc.y + ALTO_FIRMA > doc.page.height - doc.page.margins.bottom) doc.addPage();
  doc.moveDown(3.5);
  const y = doc.y;
  const x = doc.page.margins.left;
  doc.moveTo(x, y).lineTo(x + 220, y).lineWidth(0.75).strokeColor(INK).stroke();
  doc.moveDown(0.4);
  doc.font(F.medium).fontSize(11).fillColor(INK).text(`Fdo.: ${texto(therapistName) || "________________________"}`);
  doc.font(F.regular).fontSize(9).fillColor(MUTED).text("Terapeuta");
}

/**
 * Devuelve el Buffer del PDF.
 * @param report  fila de ClinicalReport (o su JSON)
 * @param patient { name } del paciente
 * @param therapist { name } de quien firma, si se conoce
 * @param patientSpecialties  claves de especialidad del paciente (solo las usa
 *   el informe de beca, para la denominación oficial de la cabecera)
 */
export async function buildReportPdfBuffer({ report, patientName, therapistName, tenantName, brand, tenant = null, patientSpecialties = [] }) {
  const cs = report.contentSections && typeof report.contentSections === "object" ? report.contentSections : {};
  const beca = esInformeBeca(report.reportType);
  const tipoLabel = beca ? "Informe para beca" : (REPORT_TYPE_LABEL[report.reportType] ?? "Informe");

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument(PAGE);
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const F = registerPoppins(doc);
      cabecera(doc, F, {
        tenantName,
        brand,
        tipoLabel,
        subtitulos: beca ? denominacionesBeca(patientSpecialties) : [],
      });
      fichaDatos(doc, F, [
        ["Paciente", texto(patientName)],
        ["Fecha del informe", fmtFecha(report.reportDate)],
        ["Profesional", texto(therapistName)],
        [
          "Especialidad de destino",
          // Del catálogo DEL CENTRO, no solo del de fábrica (24/08/2026). Las
          // especialidades de derivación son editables por tenant desde
          // Configuración, y `slugEspecialidad` convierte «Logopeda» en la clave
          // `logopeda`, que NO está en el catálogo global: el informe que recibe
          // la familia imprimía `terapia_ocupacional` con guion bajo en lugar de
          // la etiqueta. `referralSpecialtyLabelOf` ya existía con el respaldo
          // bueno (catálogo del centro → catálogo global → la clave), y este era
          // uno de los pocos sitios que no la usaba. Sin `tenant` se comporta
          // exactamente como antes, así que ningún llamador se rompe.
          cs.referralSpecialty ? referralSpecialtyLabelOf(tenant, cs.referralSpecialty) : "",
        ],
      ]);

      // La beca imprime SUS TRES apartados y ninguno más, aunque el resto del
      // informe clínico esté escrito: la convocatoria pide lo que pide
      // (lib/clinica/beca.js). Los demás tipos, las siete de siempre.
      const secciones = beca ? SECCIONES_BECA : SECCIONES;

      let algo = false;
      for (const s of secciones) {
        const contenido = s.lista ? lista(cs[s.key]) : (texto(cs[s.key]) ? [texto(cs[s.key])] : []);
        if (!contenido.length) continue;
        algo = true;
        seccion(doc, F, s.label, contenido, s.lista);
      }

      // Texto redactado por IA que aún no se ha repartido en secciones: se
      // imprime tal cual antes que dar un PDF en blanco. En la beca NO: ese
      // texto trae el informe entero y aquí solo pueden viajar sus apartados.
      const bruto = texto(report.aiGenerated);
      if (!algo && bruto && !beca) {
        algo = true;
        seccion(doc, F, "Informe", [bruto], false);
      }
      if (!algo) {
        doc.font(F.italic).fontSize(11).fillColor(MUTED).text("Este informe todavía no tiene contenido redactado.");
      }

      // La firma del terapeuta es requisito del informe de beca.
      if (beca) firma(doc, F, therapistName);

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
