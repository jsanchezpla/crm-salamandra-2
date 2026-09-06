/**
 * lib/billing/ticketPdf.js — el TICKET de un cobro (04/09/2026, Rodrigo: «en la
 * vista lateral del cobro debería salir un botón de generar ticket que generará
 * un ticket automáticamente de cobro»).
 *
 * Es el papelito que se le da a la familia cuando paga en recepción. No es una
 * factura y no pretende serlo: en Aumenta se cobra durante el mes y se factura
 * al cierre, así que entre el pago y la factura pasan semanas y la familia se
 * queda sin nada en la mano. El ticket tapa ese hueco.
 *
 * ── QUE NO SE CONFUNDA CON UNA FACTURA ──────────────────────────────────────
 * Lo dice el propio documento, en su pie y en su título: «Justificante de
 * cobro» y «Este documento no es una factura». Es lo correcto y además evita el
 * problema de verdad: que una familia lo archive como justificante fiscal y
 * luego reclame la factura que sí existe (o que no la pida y se quede sin
 * ella). Cuando el cobro SÍ tiene factura detrás, se imprime su número.
 *
 * ── EL TAMAÑO ───────────────────────────────────────────────────────────────
 * 80 mm de ancho, el rollo estándar de una impresora de tickets, y alto
 * calculado por el contenido. En una impresora normal sale igual: los lectores
 * de PDF imprimen «ajustar a página» por defecto y el ticket se agranda a A4
 * sin cortarse. Al revés —maquetarlo en A4— no funcionaría en el rollo.
 */

import PDFDocument from "pdfkit";

import { registerPoppins } from "../pdf/fonts.js";

const MM = 72 / 25.4;
// El papel sobre el que se MIDE: largo de sobra para que nada se parta en dos
// mientras se calcula el alto de verdad. Ver `buildTicketPdfBuffer`.
const ALTO_PARA_MEDIR = 2000;
const ANCHO = 80 * MM; // 226,77 pt: el rollo de 80 mm
const MARGEN = 8 * MM;
const UTIL = ANCHO - MARGEN * 2;

const INK = "#111827";
const MUTED = "#6b7280";
const LINE = "#d1d5db";

const NUM = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n) => `${NUM.format(Number(n || 0))} €`;

export const METODO_TICKET = {
  cash: "Efectivo",
  card: "Tarjeta",
  transfer: "Transferencia",
  direct_debit: "Domiciliación",
};

/** Fecha y hora del cobro, en Madrid: el servidor va en UTC y el mostrador, no. */
function fechaHoraMadrid(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleString("es-ES", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Madrid",
  });
}

/** «septiembre de 2026» a partir de 'AAAA-MM'. */
export function mesLegibleTicket(periodMonth) {
  const m = /^(\d{4})-(\d{2})/.exec(String(periodMonth ?? ""));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  return d.toLocaleDateString("es-ES", { month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * QUÉ se ha cobrado, en una línea. Puro y exportado porque es lo único
 * discutible del ticket y hay que poder probarlo sin generar un PDF.
 *
 * Por orden: la factura si la hay (es lo más concreto), el mes de la cuota si
 * el cobro es de un mes, y si no, «Cobro». La nota del cobro va aparte, debajo:
 * no sustituye al concepto, lo explica.
 */
export function conceptoDelTicket({ invoiceNumber, periodMonth } = {}) {
  if (invoiceNumber) return `Factura ${invoiceNumber}`;
  const mes = mesLegibleTicket(periodMonth);
  if (mes) return `Cuota de ${mes}`;
  return "Cobro";
}

/** El nombre del fichero que se descarga. */
export function ticketPdfFilename(payment) {
  const fecha = payment?.paidAt ? new Date(payment.paidAt).toISOString().slice(0, 10) : "sin-fecha";
  return `ticket-${fecha}-${String(payment?.id ?? "").slice(0, 8)}.pdf`.replace(/[\\/:*?"<>|]/g, "-");
}

/**
 * El ticket, como Buffer.
 *
 * @param {object}  args
 * @param {object}  args.payment   el cobro (amount, method, paidAt, notes, periodMonth).
 * @param {?string} args.clientName   quién paga.
 * @param {?string} args.patientName  por quién (el niño), si lo hay.
 * @param {?string} args.invoiceNumber  la factura, si el cobro va contra una.
 * @param {object}  args.settings  TenantBillingSettings (emisor y pie).
 * @param {?Buffer} args.logo      el logo ya cargado, o null.
 */
export function buildTicketPdfBuffer(datos) {
  return new Promise((resolve, reject) => {
    try {
      /*
       * DOS PASADAS, porque pdfkit exige el tamaño de la página ANTES de
       * escribir en ella y el alto de un ticket depende de lo que lleve
       * dentro: una dirección que dobla, una nota larga, un concepto que
       * ocupa dos líneas.
       *
       * Estimarlo a ojo ya falló: con los ajustes reales de Aumenta el
       * justificante se partía en DOS páginas, que es justo lo que no se puede
       * entregar en un mostrador. Así que se dibuja una vez sobre un papel
       * deliberadamente largo solo para medir dónde acaba, y se vuelve a
       * dibujar sobre el papel exacto. Un ticket son 15 KB y ~15 ms: medir sale
       * mucho más barato que acertar.
       */
      const medidor = new PDFDocument({ size: [ANCHO, ALTO_PARA_MEDIR], margin: MARGEN });
      medidor.on("data", () => {}); // que fluya; el buffer del medidor se tira
      renderTicket(medidor, registerPoppins(medidor), datos);
      const alto = Math.min(Math.ceil(medidor.y + MARGEN), ALTO_PARA_MEDIR);
      medidor.end();

      const doc = new PDFDocument({ size: [ANCHO, alto], margin: MARGEN });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));

      renderTicket(doc, registerPoppins(doc), datos);
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

function renderTicket(doc, F, { payment, clientName, patientName, invoiceNumber, settings, logo }) {
  const centro = (texto, opts = {}) => doc.text(texto, MARGEN, doc.y, { width: UTIL, align: "center", ...opts });

  if (logo) {
    try {
      doc.image(logo, MARGEN + UTIL / 2 - 20, doc.y, { fit: [40, 40], align: "center" });
      doc.y += 46;
    } catch {
      // Un logo ilegible no puede dejar sin ticket a nadie.
    }
  }

  doc.fillColor(INK).font(F.bold).fontSize(10);
  const nombreCentro = settings?.fiscalName || settings?.name || null;
  if (nombreCentro) centro(nombreCentro);
  doc.font(F.regular).fontSize(7).fillColor(MUTED);
  if (settings?.taxId) centro(`NIF ${settings.taxId}`);
  // La dirección del centro vive en `fiscalAddress`/`fiscalZip`/`fiscalCity`
  // (revisión del 06/09/2026: `settings.address` no existe y nunca salía).
  const direccion = [settings?.fiscalAddress, [settings?.fiscalZip, settings?.fiscalCity].filter(Boolean).join(" ")]
    .filter((x) => x && String(x).trim())
    .join(" · ");
  if (direccion) centro(direccion);

  doc.moveDown(0.6);
  regla(doc);
  doc.moveDown(0.5);

  doc.font(F.bold).fontSize(9).fillColor(INK);
  centro("JUSTIFICANTE DE COBRO");
  doc.font(F.regular).fontSize(7).fillColor(MUTED);
  centro(`Nº ${String(payment?.id ?? "").slice(0, 8).toUpperCase()}`);
  centro(fechaHoraMadrid(payment?.paidAt));

  doc.moveDown(0.6);
  regla(doc);
  doc.moveDown(0.5);

  // Quién y por quién. El paciente primero, como en toda pantalla de dinero
  // del CRM desde el 03/09/2026.
  doc.fontSize(8);
  if (patientName) fila(doc, F, "Paciente", patientName);
  if (clientName) fila(doc, F, "Pagador", clientName);
  fila(doc, F, "Concepto", conceptoDelTicket({ invoiceNumber, periodMonth: payment?.periodMonth }));
  fila(doc, F, "Forma de pago", METODO_TICKET[payment?.method] ?? String(payment?.method ?? "—"));

  if (payment?.notes) {
    doc.moveDown(0.3);
    doc.font(F.italic).fontSize(7).fillColor(MUTED);
    doc.text(String(payment.notes), MARGEN, doc.y, { width: UTIL });
  }

  doc.moveDown(0.6);
  regla(doc);
  doc.moveDown(0.4);

  doc.font(F.bold).fontSize(14).fillColor(INK);
  centro(money(payment?.amount));
  doc.font(F.regular).fontSize(7).fillColor(MUTED);
  centro("importe cobrado");

  doc.moveDown(0.8);
  regla(doc);
  doc.moveDown(0.4);

  doc.font(F.regular).fontSize(6.5).fillColor(MUTED);
  centro(
    invoiceNumber
      ? `Este documento no es una factura: acredita el cobro de la factura ${invoiceNumber}.`
      : "Este documento no es una factura: acredita únicamente el cobro. La factura se emite aparte."
  );
  if (settings?.invoiceFooterText) {
    doc.moveDown(0.4);
    doc.fontSize(6);
    centro(String(settings.invoiceFooterText));
  }
}

/** Una línea «rótulo … valor», con el valor alineado a la derecha. */
function fila(doc, F, rotulo, valor) {
  const y = doc.y;
  doc.font(F.regular).fillColor(MUTED).text(rotulo, MARGEN, y, { width: UTIL * 0.42 });
  doc
    .font(F.medium)
    .fillColor(INK)
    .text(String(valor ?? "—"), MARGEN + UTIL * 0.42, y, { width: UTIL * 0.58, align: "right" });
  doc.y = Math.max(doc.y, y + 11);
}

function regla(doc) {
  doc.strokeColor(LINE).lineWidth(0.5).moveTo(MARGEN, doc.y).lineTo(ANCHO - MARGEN, doc.y).stroke();
}
