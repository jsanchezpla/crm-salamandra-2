/**
 * estadisticasExport — el Excel y el PDF de las estadísticas del centro
 * (bloque 6 del sprint Aumenta, punto 10).
 *
 * (Fichero nuevo en /lib, regla #2: el helper de Excel que ya existía
 * —`lib/billing/exportXlsx.js`— hace UNA hoja con UNA tabla, que es lo que
 * necesita Facturación. Aquí hacen falta varias hojas, y el PDF no tiene nada
 * que ver con facturas.)
 *
 * Los dos formatos parten del MISMO objeto que pinta la pantalla
 * (`calcularEstadisticas`): lo que se lleva a la reunión de dirección no puede
 * decir una cosa distinta de lo que se ve en el CRM.
 */

import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { registerPoppins } from "../pdf/fonts.js";

const INK = "#1F2937";
const MUTED = "#6B7280";
const HAIRLINE = "#E5E7EB";

function fmtRango(stats) {
  const f = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
  return `${f(stats.desde)} — ${f(stats.hasta)}`;
}

const noNulo = (v, sufijo = "") => (v == null ? "—" : `${v}${sufijo}`);

// ── Excel ───────────────────────────────────────────────────────────────────

function hoja(libro, nombre, columnas, filas) {
  const h = libro.addWorksheet(nombre);
  h.columns = columnas;
  h.getRow(1).font = { bold: true };
  h.getRow(1).alignment = { vertical: "middle" };
  filas.forEach((f) => h.addRow(f));
  h.views = [{ state: "frozen", ySplit: 1 }];
  return h;
}

export async function buildEstadisticasXlsx(stats, { tenantName } = {}) {
  const libro = new ExcelJS.Workbook();
  libro.creator = tenantName || "CRM Salamandra";

  // Hoja 1: el resumen, que es lo que se mira primero.
  const resumen = [];
  const push = (bloque, dato, valor) => resumen.push({ bloque, dato, valor });
  if (stats.clinica) {
    push("Actividad clínica", "Pacientes activos", stats.clinica.pacientesActivos);
    push("Actividad clínica", "Pacientes en pausa", stats.clinica.pacientesEnPausa);
    push("Actividad clínica", "Altas del periodo", stats.clinica.altas);
    push("Actividad clínica", "Bajas del periodo", stats.clinica.bajas);
    push("Actividad clínica", "Sesiones registradas", stats.clinica.sesiones);
    push("Actividad clínica", "Informes del periodo", stats.clinica.informes);
    push("Actividad clínica", "Informes entregados", stats.clinica.informesEntregados);
    push("Actividad clínica", "Entregados en plazo (%)", noNulo(stats.clinica.informesEnPlazoPct));
  }
  if (stats.agenda) {
    push("Agenda", "Citas del periodo", stats.agenda.total);
    for (const e of stats.agenda.porEstado) push("Agenda", e.label, e.citas);
    push("Agenda", "Faltas justificadas", stats.agenda.faltasJustificadas);
    push("Agenda", "Faltas sin justificar", stats.agenda.faltasSinJustificar);
    push("Agenda", "Tasa de ausencias (%)", noNulo(stats.agenda.tasaAusenciasPct));
  }
  if (stats.captacion) {
    push("Captación", "Leads nuevos", stats.captacion.leads);
    push("Captación", "Clientes nuevos", stats.captacion.clientesNuevos);
    push("Captación", "En lista de espera", stats.captacion.listaEspera.enEspera);
    push("Captación", "Convertidos desde la lista", stats.captacion.listaEspera.convertidos);
    push("Captación", "Espera media (días)", noNulo(stats.captacion.listaEspera.esperaMediaDias));
  }
  hoja(
    libro,
    "Resumen",
    [
      { header: "Bloque", key: "bloque", width: 22 },
      { header: "Dato", key: "dato", width: 34 },
      { header: "Valor", key: "valor", width: 14 },
    ],
    resumen
  );

  if (stats.clinica?.terapeutas?.length) {
    hoja(
      libro,
      "Por terapeuta",
      [
        { header: "Terapeuta", key: "name", width: 30 },
        { header: "Sesiones", key: "sesiones", width: 12 },
        { header: "Informes", key: "informes", width: 12 },
      ],
      stats.clinica.terapeutas
    );
  }
  if (stats.agenda?.profesionales?.length) {
    hoja(
      libro,
      "Agenda por profesional",
      [
        { header: "Profesional", key: "name", width: 30 },
        { header: "Citas", key: "citas", width: 10 },
        { header: "Atendidas", key: "atendidas", width: 12 },
        { header: "Faltas", key: "faltas", width: 10 },
        { header: "Ausencias (%)", key: "tasaAusenciasPct", width: 14 },
      ],
      stats.agenda.profesionales
    );
  }
  if (stats.captacion?.leadsPorOrigen?.length) {
    hoja(
      libro,
      "Captación",
      [
        { header: "Origen", key: "origen", width: 28 },
        { header: "Leads", key: "leads", width: 10 },
      ],
      stats.captacion.leadsPorOrigen
    );
  }
  if (stats.clinica?.especialidades?.length) {
    hoja(
      libro,
      "Especialidades",
      [
        { header: "Especialidad", key: "label", width: 28 },
        { header: "Pacientes activos", key: "pacientes", width: 18 },
      ],
      stats.clinica.especialidades
    );
  }

  return Buffer.from(await libro.xlsx.writeBuffer());
}

// ── PDF ─────────────────────────────────────────────────────────────────────

function bloqueTitulo(doc, F, texto) {
  doc.moveDown(0.6);
  doc.font(F.bold).fontSize(13).fillColor(INK).text(texto);
  doc.moveDown(0.3);
}

function filaDato(doc, F, etiqueta, valor) {
  const y = doc.y;
  doc.font(F.regular).fontSize(10).fillColor(MUTED).text(etiqueta, doc.page.margins.left, y, { width: 320 });
  doc.font(F.medium).fontSize(10).fillColor(INK).text(String(valor), doc.page.margins.left + 330, y, { width: 160, align: "right" });
  doc.moveDown(0.15);
}

function tablita(doc, F, cabeceras, filas) {
  const izq = doc.page.margins.left;
  const ancho = doc.page.width - izq - doc.page.margins.right;
  const col = ancho / cabeceras.length;
  const y0 = doc.y;
  doc.font(F.medium).fontSize(9).fillColor(MUTED);
  cabeceras.forEach((c, i) => doc.text(c, izq + i * col, y0, { width: col - 6, align: i === 0 ? "left" : "right" }));
  doc.moveDown(0.3);
  doc.moveTo(izq, doc.y).lineTo(izq + ancho, doc.y).lineWidth(0.5).strokeColor(HAIRLINE).stroke();
  doc.moveDown(0.25);
  doc.font(F.regular).fontSize(10).fillColor(INK);
  for (const fila of filas) {
    // Salto de página si no cabe: un informe cortado a mitad de tabla no lo
    // lee nadie dos veces.
    if (doc.y > doc.page.height - doc.page.margins.bottom - 30) doc.addPage();
    const y = doc.y;
    fila.forEach((v, i) => doc.text(String(v), izq + i * col, y, { width: col - 6, align: i === 0 ? "left" : "right" }));
    doc.moveDown(0.2);
  }
}

export async function buildEstadisticasPdf(stats, { tenantName, brand } = {}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margins: { top: 56, bottom: 56, left: 56, right: 56 } });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      const F = registerPoppins(doc);

      doc.font(F.medium).fontSize(10).fillColor(MUTED).text(tenantName || "Centro");
      doc.moveDown(0.3);
      doc.font(F.bold).fontSize(20).fillColor(INK).text("Estadísticas del centro");
      doc.font(F.regular).fontSize(10).fillColor(MUTED).text(fmtRango(stats));
      doc.moveDown(0.4);
      const y = doc.y;
      doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y)
        .lineWidth(2).strokeColor(brand?.primaryColor || "#1B3A2D").stroke();

      if (stats.clinica) {
        bloqueTitulo(doc, F, "Actividad clínica");
        filaDato(doc, F, "Pacientes activos", stats.clinica.pacientesActivos);
        filaDato(doc, F, "Altas / bajas del periodo", `${stats.clinica.altas} / ${stats.clinica.bajas}`);
        filaDato(doc, F, "Sesiones registradas", stats.clinica.sesiones);
        filaDato(doc, F, "Informes (entregados)", `${stats.clinica.informes} (${stats.clinica.informesEntregados})`);
        filaDato(doc, F, "Entregados en plazo", noNulo(stats.clinica.informesEnPlazoPct, " %"));
        if (stats.clinica.terapeutas.length) {
          doc.moveDown(0.5);
          tablita(doc, F, ["Terapeuta", "Sesiones", "Informes"], stats.clinica.terapeutas.map((t) => [t.name, t.sesiones, t.informes]));
        }
      }

      if (stats.agenda) {
        bloqueTitulo(doc, F, "Agenda y ausencias");
        filaDato(doc, F, "Citas del periodo", stats.agenda.total);
        for (const e of stats.agenda.porEstado) filaDato(doc, F, e.label, e.citas);
        filaDato(doc, F, "Faltas justificadas / sin justificar", `${stats.agenda.faltasJustificadas} / ${stats.agenda.faltasSinJustificar}`);
        filaDato(doc, F, "Tasa de ausencias", noNulo(stats.agenda.tasaAusenciasPct, " %"));
        if (stats.agenda.profesionales.length) {
          doc.moveDown(0.5);
          tablita(
            doc,
            F,
            ["Profesional", "Citas", "Atendidas", "Faltas"],
            stats.agenda.profesionales.map((p) => [p.name, p.citas, p.atendidas, p.faltas])
          );
        }
      }

      if (stats.captacion) {
        bloqueTitulo(doc, F, "Captación");
        filaDato(doc, F, "Leads nuevos", stats.captacion.leads);
        filaDato(doc, F, "Clientes nuevos", stats.captacion.clientesNuevos);
        filaDato(doc, F, "En lista de espera ahora", stats.captacion.listaEspera.enEspera);
        filaDato(doc, F, "Entraron desde la lista de espera", stats.captacion.listaEspera.convertidos);
        filaDato(doc, F, "Espera media", noNulo(stats.captacion.listaEspera.esperaMediaDias, " días"));
        if (stats.captacion.leadsPorOrigen.length) {
          doc.moveDown(0.5);
          tablita(doc, F, ["Origen del lead", "Leads"], stats.captacion.leadsPorOrigen.map((o) => [o.origen, o.leads]));
        }
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
