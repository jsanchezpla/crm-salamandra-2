import PDFDocument from "pdfkit";
import { datosFiscalesDe } from "./datosFiscales.js";

/**
 * Genera el PDF de una factura emitida con pdfkit (server-side, sin navegador
 * headless). Devuelve un Buffer (una factura = 1-2 páginas, cabe en memoria sin
 * problema). Para el bulk se generan buffers y se van añadiendo al ZIP en streaming.
 *
 * Datos:
 *   - invoice: modelo Invoice (con lines[], totales, series/number, fechas).
 *   - client:  modelo Client (fiscalName/name, taxId, dirección fiscal).
 *   - settings: TenantBillingSettings (emisor: fiscalName, taxId, dirección, pie).
 *   - partnerName: nombre del socio que factura (settings.partners[x].name), opcional.
 */

const NUM = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" });
function money(n) {
  return `${NUM.format(Number(n || 0))} €`;
}
function pct(n) {
  return `${NUM.format(Number(n || 0))} %`;
}
function fmtDate(d) {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d + "T00:00:00") : new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString("es-ES");
}

const STATUS_LABEL = {
  issued: "Emitida",
  sent: "Enviada",
  paid: "Cobrada",
  partially_paid: "Cobro parcial",
  overdue: "Vencida",
  cancelled: "Anulada",
  rectified: "Rectificada",
  draft: "Borrador",
};

export function buildInvoicePdfBuffer({ invoice, client, settings, partnerName }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      renderInvoice(doc, { invoice, client, settings: settings || {}, partnerName });
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

export function invoicePdfFilename(invoice) {
  const label = invoice.status === "draft" ? `borrador-${String(invoice.id).slice(0, 8)}` : invoice.number;
  return `factura-${label}.pdf`.replace(/[\\/:*?"<>|]/g, "-");
}

// ─── Render ──────────────────────────────────────────────────────────────────

const LEFT = 50;
const RIGHT = 545; // 595.28 (A4) - 50 margen
const INK = "#111827";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";

function renderInvoice(doc, { invoice, client, settings, partnerName }) {
  // ── Cabecera: emisor (izq) + FACTURA nº (der) ──
  const topY = 50;
  doc.font("Helvetica-Bold").fontSize(16).fillColor(INK).text(settings.fiscalName || "—", LEFT, topY, { width: 300 });
  doc.font("Helvetica").fontSize(9).fillColor(MUTED);
  const emisorLines = [
    settings.taxId ? `NIF/CIF: ${settings.taxId}` : null,
    settings.fiscalAddress || null,
    [settings.fiscalZip, settings.fiscalCity].filter(Boolean).join(" ") || null,
    settings.fiscalCountry && settings.fiscalCountry !== "ES" ? settings.fiscalCountry : null,
  ].filter(Boolean);
  doc.text(emisorLines.join("\n"), LEFT, topY + 22, { width: 260 });

  doc.font("Helvetica-Bold").fontSize(20).fillColor(INK).text("FACTURA", 320, topY, { width: RIGHT - 320, align: "right" });
  const numLabel = invoice.status === "draft" ? "BORRADOR" : `${invoice.series || ""}${invoice.number ? " · " + invoice.number : ""}`;
  doc.font("Helvetica").fontSize(11).fillColor(MUTED).text(numLabel, 320, topY + 26, { width: RIGHT - 320, align: "right" });
  doc.fontSize(9).text(`Estado: ${STATUS_LABEL[invoice.status] || invoice.status}`, 320, topY + 42, { width: RIGHT - 320, align: "right" });

  // ── Bloque cliente + meta ──
  const blockY = 128;
  doc.moveTo(LEFT, blockY - 10).lineTo(RIGHT, blockY - 10).strokeColor(LINE).lineWidth(1).stroke();

  doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED).text("FACTURAR A", LEFT, blockY);
  // A quién se le emitió: la foto congelada al emitir si la factura la tiene, y
  // si no —las 14.243 anteriores al 26/08/2026— la ficha viva, como siempre.
  // Ver `lib/billing/datosFiscales.js`. El CORREO se queda fuera de la foto a
  // propósito: no es un dato fiscal, es por dónde se le escribe hoy.
  const fiscales = datosFiscalesDe(invoice, client);
  doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(fiscales.nombre || "—", LEFT, blockY + 14, { width: 260 });
  doc.font("Helvetica").fontSize(9).fillColor(MUTED);
  const clientLines = [
    fiscales.nif ? `NIF/CIF: ${fiscales.nif}` : null,
    fiscales.direccion,
    [fiscales.cp, fiscales.ciudad].filter(Boolean).join(" ") || null,
    client?.email || null,
  ].filter(Boolean);
  // Las señas van DEBAJO del nombre de verdad, no a una altura fija: una razón
  // social de más de ~45 caracteres ocupa dos líneas y con `blockY + 30` el
  // NIF se imprimía ENCIMA de la segunda (comprobado con «Asociación de Madres
  // y Padres del Colegio…»: nombre en y=163 y NIF en y=164,5). Con un nombre de
  // una línea esto da 157 en vez de 158: mismo sitio a ojo.
  doc.text(clientLines.join("\n") || "—", LEFT, doc.y + 2, { width: 260 });
  const finBloqueCliente = doc.y;

  // Meta (derecha)
  const metaX = 340;
  const meta = [
    ["Fecha de emisión", fmtDate(invoice.issueDate)],
    ["Vencimiento", fmtDate(invoice.dueDate)],
    partnerName ? ["Emitida por", partnerName] : null,
  ].filter(Boolean);
  let my = blockY;
  for (const [k, v] of meta) {
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(k, metaX, my, { width: 100 });
    doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text(v, metaX + 105, my, { width: RIGHT - (metaX + 105), align: "right" });
    my += 15;
  }

  // ── Tabla de líneas ──
  const cols = {
    desc: { x: LEFT, w: 210, align: "left", label: "Concepto" },
    qty: { x: 262, w: 45, align: "right", label: "Cant." },
    price: { x: 310, w: 65, align: "right", label: "Precio" },
    disc: { x: 378, w: 42, align: "right", label: "Dto." },
    vat: { x: 423, w: 42, align: "right", label: "IVA" },
    base: { x: 468, w: RIGHT - 468, align: "right", label: "Importe" },
  };
  // La tabla empieza por debajo del más alto de los dos bloques de arriba (el
  // del cliente crece si la razón social o la dirección ocupan más líneas).
  let y = Math.max(blockY + 78, my + 14, finBloqueCliente + 8);

  // Cabecera tabla
  doc.rect(LEFT, y, RIGHT - LEFT, 20).fill("#f3f4f6");
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(INK);
  for (const c of Object.values(cols)) {
    doc.text(c.label, c.x + (c.align === "right" ? 0 : 4), y + 6, { width: c.w - 4, align: c.align });
  }
  y += 24;

  const lines = Array.isArray(invoice.lines) ? invoice.lines : [];
  doc.font("Helvetica").fontSize(9).fillColor(INK);
  for (const l of lines) {
    // salto de página si no cabe
    if (y > 720) {
      doc.addPage();
      y = 50;
    }
    const descH = doc.heightOfString(l.description || "—", { width: cols.desc.w - 4 });
    const rowH = Math.max(descH, 12) + 8;
    doc.fillColor(INK).text(l.description || "—", cols.desc.x + 4, y, { width: cols.desc.w - 4 });
    doc.text(NUM.format(Number(l.quantity || 0)), cols.qty.x, y, { width: cols.qty.w, align: "right" });
    doc.text(money(l.unitPrice), cols.price.x, y, { width: cols.price.w, align: "right" });
    doc.text(Number(l.discountPct || 0) ? pct(l.discountPct) : "—", cols.disc.x, y, { width: cols.disc.w, align: "right" });
    doc.text(pct(l.vatRate), cols.vat.x, y, { width: cols.vat.w, align: "right" });
    doc.text(money(l.lineBase ?? Number(l.quantity || 0) * Number(l.unitPrice || 0)), cols.base.x, y, { width: cols.base.w, align: "right" });
    y += rowH;
    doc.moveTo(LEFT, y - 4).lineTo(RIGHT, y - 4).strokeColor(LINE).lineWidth(0.5).stroke();
  }

  // ── Totales ──
  if (y > 680) { doc.addPage(); y = 50; }
  y += 10;
  const totX = 360;
  const labelW = 120;

  // Desglose de IVA por tipo
  const byRate = new Map();
  for (const l of lines) {
    const rate = String(Number(l.vatRate || 0));
    const agg = byRate.get(rate) ?? { base: 0, vat: 0 };
    agg.base += Number(l.lineBase || 0);
    agg.vat += Number(l.lineVat || 0);
    byRate.set(rate, agg);
  }

  const rows = [["Base imponible", money(invoice.taxBase)]];
  for (const [rate, agg] of [...byRate.entries()].sort((a, b) => Number(b[0]) - Number(a[0]))) {
    rows.push([`IVA ${NUM.format(Number(rate))} %`, money(agg.vat)]);
  }
  if (Number(invoice.irpfAmount) > 0) {
    rows.push([`IRPF -${NUM.format(Number(invoice.irpfRate))} %`, `- ${money(invoice.irpfAmount)}`]);
  }
  doc.font("Helvetica").fontSize(9.5).fillColor(INK);
  for (const [k, v] of rows) {
    doc.fillColor(MUTED).text(k, totX, y, { width: labelW, align: "left" });
    doc.fillColor(INK).text(v, totX + labelW, y, { width: RIGHT - (totX + labelW), align: "right" });
    y += 16;
  }
  // Total destacado
  doc.moveTo(totX, y + 2).lineTo(RIGHT, y + 2).strokeColor(INK).lineWidth(1).stroke();
  y += 8;
  doc.font("Helvetica-Bold").fontSize(12).fillColor(INK);
  // ── La casilla del TOTAL es más ancha que las de arriba (24/08/2026) ──────
  // Con `labelW` (120) al importe le quedaban 65 pt, y en Helvetica-Bold 12
  // «100.000,00 €» mide 70,1: pdfkit lo partía en dos renglones y la factura
  // salía con el importe a medias («100.000,00» y debajo «€»), justo en el
  // documento que abre la gestoría. No hacía falta ninguna entrada rara: la
  // columna es DECIMAL(12,2) y el campo de la pantalla no tiene tope, así que
  // una factura anual o un pedido grande llega solo.
  //
  // A la etiqueta le bastan 38 pt de los 120, así que se le dejan 60 y el
  // importe se dibuja desde ahí: 125 pt, donde cabe el rango ENTERO de la
  // columna (9.999.999.999,99 € mide 103,4). Como va alineado a la derecha y
  // las dos cajas comparten el borde derecho, los importes que ya cabían se
  // siguen dibujando en la misma x: la factura de todos los días no se mueve.
  //
  // Lo que esto NO arregla, para que nadie lo dé por cerrado: las subfilas
  // (Base imponible, IVA, IRPF) siguen en la casilla de 65 pt, en Helvetica
  // 9.5, y se partirían a partir de 10.000.000,00 €.
  const totalW = 60;
  doc.text("TOTAL", totX, y, { width: totalW, align: "left" });
  doc.text(money(invoice.total), totX + totalW, y, { width: RIGHT - (totX + totalW), align: "right" });
  y += 24;

  if (Number(invoice.paidAmount) > 0 && Number(invoice.paidAmount) < Number(invoice.total)) {
    doc.font("Helvetica").fontSize(9).fillColor(MUTED)
      .text(`Cobrado: ${money(invoice.paidAmount)}  ·  Pendiente: ${money(Number(invoice.total) - Number(invoice.paidAmount))}`, totX - 100, y, { width: RIGHT - (totX - 100), align: "right" });
    y += 16;
  }

  // Nota de exención de IVA (congelada en la factura al crearla si el emisor
  // no repercute IVA). Va sobre las notas, junto a los totales.
  const exemptNote = invoice.customFields?.vatExemptNote;
  if (exemptNote) {
    if (y > 730) { doc.addPage(); y = 50; }
    doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(MUTED)
      .text(exemptNote, LEFT, y, { width: RIGHT - LEFT });
    y += 22;
  }

  // ── Notas + pie ──
  if (invoice.notes) {
    if (y > 720) { doc.addPage(); y = 50; }
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(MUTED).text("NOTAS", LEFT, y);
    doc.font("Helvetica").fontSize(9).fillColor(INK).text(invoice.notes, LEFT, y + 12, { width: RIGHT - LEFT });
  }

  const footer = settings.invoiceFooterText;
  if (footer) {
    doc.font("Helvetica").fontSize(8).fillColor(MUTED)
      .text(footer, LEFT, 780, { width: RIGHT - LEFT, align: "center" });
  }
}
