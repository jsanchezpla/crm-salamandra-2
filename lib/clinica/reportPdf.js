import PDFDocument from "pdfkit";
import { registerPoppins } from "../pdf/fonts.js";
import { REPORT_TYPE_LABEL } from "./serialize.js";
import { referralSpecialtyLabelOf } from "./derivaciones.js";

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

function cabecera(doc, F, { tenantName, brand, tipoLabel }) {
  const acento = brand?.primaryColor || "#1B3A2D";
  doc.font(F.medium).fontSize(10).fillColor(MUTED).text(texto(tenantName) || "Informe clínico");
  doc.moveDown(0.35);
  doc.font(F.bold).fontSize(20).fillColor(INK).text(tipoLabel);
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
 * Devuelve el Buffer del PDF.
 * @param report  fila de ClinicalReport (o su JSON)
 * @param patient { name } del paciente
 * @param therapist { name } de quien firma, si se conoce
 */
export async function buildReportPdfBuffer({ report, patientName, therapistName, tenantName, brand, tenant = null }) {
  const cs = report.contentSections && typeof report.contentSections === "object" ? report.contentSections : {};
  const tipoLabel = REPORT_TYPE_LABEL[report.reportType] ?? "Informe";

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument(PAGE);
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const F = registerPoppins(doc);
      cabecera(doc, F, { tenantName, brand, tipoLabel });
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

      let algo = false;
      for (const s of SECCIONES) {
        const contenido = s.lista ? lista(cs[s.key]) : (texto(cs[s.key]) ? [texto(cs[s.key])] : []);
        if (!contenido.length) continue;
        algo = true;
        seccion(doc, F, s.label, contenido, s.lista);
      }

      // Texto redactado por IA que aún no se ha repartido en secciones: se
      // imprime tal cual antes que dar un PDF en blanco.
      const bruto = texto(report.aiGenerated);
      if (!algo && bruto) {
        algo = true;
        seccion(doc, F, "Informe", [bruto], false);
      }
      if (!algo) {
        doc.font(F.italic).fontSize(11).fillColor(MUTED).text("Este informe todavía no tiene contenido redactado.");
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
