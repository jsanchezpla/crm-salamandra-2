/**
 * lib/productos/ventasExport.js — el Excel y el PDF del bloque «Ventas» de
 * Productos avanzado (03/09/2026).
 *
 * (Fichero nuevo en /lib, regla #2: es el hermano de
 * `lib/clinica/estadisticasExport.js`, con el mismo reparto —el Excel para
 * trabajar los números, el PDF para llevarlos a la reunión— y sobre el MISMO
 * objeto que pinta la pantalla, el que devuelve `calcularEstadisticasProductos`.
 * Lo que se lleva a la reunión no puede decir una cosa distinta de lo que se
 * ve en el CRM: por eso aquí no se calcula nada, solo se coloca.)
 *
 * Los cuatro ayudantes del PDF (`bloqueTitulo`, `filaDato`, `tablita`, el
 * marco) son una copia de los de Clínica a propósito: son diez líneas cada uno
 * y sacarlos a `lib/pdf/` obligaría a tocar el informe del centro, que ya
 * está en producción, para no ganar nada que se vea. Si aparece un tercer
 * informe con la misma forma, ese es el momento.
 */

import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { registerPoppins } from "../pdf/fonts.js";

const INK = "#1F2937";
const MUTED = "#6B7280";
const HAIRLINE = "#E5E7EB";

const ORIGEN_LABEL = { manual: "Mostrador", tienda: "Tienda online" };
const FUENTE_LABEL = {
  ficha: "precio de compra de la ficha",
  entradas: "coste medio de las entradas de Inventario (o la ficha si el producto no tiene entradas)",
};

const eur = (n) =>
  n === null || n === undefined
    ? "—"
    : new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(n));
const num = (n) => new Intl.NumberFormat("es-ES", { maximumFractionDigits: 3 }).format(Number(n) || 0);
const pct = (n) => (n === null || n === undefined ? "—" : `${num(n)} %`);
const origen = (o) => ORIGEN_LABEL[o] ?? o;
const mes = (aaaaMm) => {
  const [a, m] = String(aaaaMm).split("-").map(Number);
  return new Date(a, m - 1, 1).toLocaleDateString("es-ES", { month: "long", year: "numeric" });
};
const fecha = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
const fmtRango = (periodo) => `${fecha(periodo.desde)} — ${fecha(periodo.hasta)}`;

/** Nombre de fichero, sin extensión: «Ventas 2026-09-01 a 2026-09-30». */
export function nombreDeFichero(datos) {
  return `Ventas ${datos.periodo.desde} a ${datos.periodo.hasta}`;
}

// ── Excel ───────────────────────────────────────────────────────────────────

const NUM_EUR = '#,##0.00 "€"';
const NUM_UDS = "#,##0.###";

function hoja(libro, nombre, columnas, filas) {
  const h = libro.addWorksheet(nombre);
  h.columns = columnas;
  h.getRow(1).font = { bold: true };
  h.getRow(1).alignment = { vertical: "middle" };
  filas.forEach((f) => h.addRow(f));
  h.views = [{ state: "frozen", ySplit: 1 }];
  return h;
}

export async function buildVentasXlsx(datos, { tenantName } = {}) {
  const libro = new ExcelJS.Workbook();
  libro.creator = tenantName || "CRM Salamandra";
  const { totales, margen } = datos;

  // Hoja 1: el resumen, que es lo que se mira primero. Las cifras van como
  // NÚMEROS, no como texto formateado: es un Excel para hacer cuentas encima.
  const resumen = [
    { bloque: "Periodo", dato: "Desde", valor: datos.periodo.desde },
    { bloque: "Periodo", dato: "Hasta", valor: datos.periodo.hasta },
    { bloque: "Ventas", dato: "Pedidos", valor: totales.pedidos },
    { bloque: "Ventas", dato: "Importe vendido (€)", valor: totales.importe },
    { bloque: "Ventas", dato: "Unidades", valor: totales.unidades },
    { bloque: "Ventas", dato: "Ticket medio (€)", valor: totales.ticketMedio },
    { bloque: "Ventas", dato: "Pedidos cancelados", valor: totales.cancelados },
    { bloque: "Ventas", dato: "Borradores (carritos sin pagar)", valor: totales.borradores },
    { bloque: "Catálogo", dato: "Productos activos", valor: datos.productosActivos },
    { bloque: "Catálogo", dato: "Sin vender en el periodo", valor: datos.sinVentas },
    { bloque: "Margen", dato: "Margen (€)", valor: margen.pct === null ? "—" : margen.importe },
    { bloque: "Margen", dato: "Margen (%)", valor: margen.pct === null ? "—" : margen.pct },
    { bloque: "Margen", dato: "Sobre importe con coste (€)", valor: margen.sobreImporte },
    { bloque: "Margen", dato: "Productos sin coste conocido", valor: margen.sinCoste },
    { bloque: "Margen", dato: "Coste usado", valor: FUENTE_LABEL[margen.fuente] ?? margen.fuente },
  ];
  hoja(
    libro,
    "Resumen",
    [
      { header: "Bloque", key: "bloque", width: 12 },
      { header: "Dato", key: "dato", width: 34 },
      { header: "Valor", key: "valor", width: 18 },
    ],
    resumen
  );

  if (datos.porProducto.length) {
    const h = hoja(
      libro,
      "Por producto",
      [
        { header: "Producto", key: "nombre", width: 36 },
        { header: "Unidades", key: "unidades", width: 11, style: { numFmt: NUM_UDS } },
        { header: "Pedidos", key: "pedidos", width: 10 },
        { header: "Vendido (€)", key: "importe", width: 14, style: { numFmt: NUM_EUR } },
        { header: "Coste unitario (€)", key: "coste", width: 18, style: { numFmt: NUM_EUR } },
        { header: "Margen (€)", key: "margen", width: 14, style: { numFmt: NUM_EUR } },
      ],
      datos.porProducto.map((f) => ({
        nombre: f.nombre,
        unidades: f.unidades,
        pedidos: f.pedidos,
        importe: f.importe,
        coste: f.coste === null ? "—" : f.coste,
        margen: f.margen === null ? "—" : f.margen,
      }))
    );
    h.getRow(1).alignment = { vertical: "middle", wrapText: true };
  }

  if (datos.porMes.length) {
    hoja(
      libro,
      "Por mes",
      [
        { header: "Mes", key: "mes", width: 12 },
        { header: "Pedidos", key: "pedidos", width: 10 },
        { header: "Unidades", key: "unidades", width: 11, style: { numFmt: NUM_UDS } },
        { header: "Importe (€)", key: "importe", width: 14, style: { numFmt: NUM_EUR } },
      ],
      datos.porMes
    );
  }

  if (datos.porOrigen.length) {
    hoja(
      libro,
      "Por origen",
      [
        { header: "Por dónde entra", key: "origen", width: 18 },
        { header: "Pedidos", key: "pedidos", width: 10 },
        { header: "Importe (€)", key: "importe", width: 14, style: { numFmt: NUM_EUR } },
      ],
      datos.porOrigen.map((o) => ({ ...o, origen: origen(o.origen) }))
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
  // La primera columna (el nombre) se lleva el doble: es la que se trunca.
  const partes = cabeceras.length + 1;
  const anchoDe = (i) => (i === 0 ? (ancho * 2) / partes : ancho / partes);
  const xDe = (i) => izq + (i === 0 ? 0 : (ancho * 2) / partes + (i - 1) * (ancho / partes));
  const y0 = doc.y;
  doc.font(F.medium).fontSize(9).fillColor(MUTED);
  cabeceras.forEach((c, i) => doc.text(c, xDe(i), y0, { width: anchoDe(i) - 6, align: i === 0 ? "left" : "right" }));
  doc.moveDown(0.3);
  doc.moveTo(izq, doc.y).lineTo(izq + ancho, doc.y).lineWidth(0.5).strokeColor(HAIRLINE).stroke();
  doc.moveDown(0.25);
  doc.font(F.regular).fontSize(10).fillColor(INK);
  for (const fila of filas) {
    // Salto de página si no cabe: un informe cortado a mitad de tabla no lo
    // lee nadie dos veces.
    if (doc.y > doc.page.height - doc.page.margins.bottom - 30) doc.addPage();
    const y = doc.y;
    fila.forEach((v, i) =>
      doc.text(String(v), xDe(i), y, { width: anchoDe(i) - 6, align: i === 0 ? "left" : "right", lineBreak: false, ellipsis: true })
    );
    doc.moveDown(0.2);
  }
}

export async function buildVentasPdf(datos, { tenantName, brand } = {}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margins: { top: 56, bottom: 56, left: 56, right: 56 } });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      const F = registerPoppins(doc);
      const { totales, margen } = datos;

      doc.font(F.medium).fontSize(10).fillColor(MUTED).text(tenantName || "Centro");
      doc.moveDown(0.3);
      doc.font(F.bold).fontSize(20).fillColor(INK).text("Ventas");
      doc.font(F.regular).fontSize(10).fillColor(MUTED).text(fmtRango(datos.periodo));
      doc.moveDown(0.4);
      const y = doc.y;
      doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y)
        .lineWidth(2).strokeColor(brand?.primaryColor || "#1B3A2D").stroke();

      bloqueTitulo(doc, F, "Lo vendido");
      filaDato(doc, F, "Importe vendido", eur(totales.importe));
      filaDato(doc, F, "Pedidos", totales.pedidos);
      filaDato(doc, F, "Unidades", num(totales.unidades));
      filaDato(doc, F, "Ticket medio", eur(totales.ticketMedio));
      filaDato(doc, F, "Cancelados / borradores sin pagar", `${totales.cancelados} / ${totales.borradores}`);
      filaDato(doc, F, "Productos activos sin vender", `${datos.sinVentas} de ${datos.productosActivos}`);

      bloqueTitulo(doc, F, "Lo ganado");
      filaDato(doc, F, "Margen", margen.pct === null ? "— (sin precio de compra en las fichas)" : eur(margen.importe));
      filaDato(doc, F, "Sobre lo vendido con coste", margen.pct === null ? "—" : `${pct(margen.pct)} de ${eur(margen.sobreImporte)}`);
      if (margen.sinCoste) filaDato(doc, F, "Productos sin coste conocido", margen.sinCoste);
      doc.moveDown(0.2);
      doc.font(F.regular).fontSize(8.5).fillColor(MUTED).text(`Coste usado: ${FUENTE_LABEL[margen.fuente] ?? margen.fuente}.`);

      if (datos.porProducto.length) {
        bloqueTitulo(doc, F, "Lo más vendido");
        tablita(
          doc,
          F,
          ["Producto", "Unidades", "Vendido", "Margen"],
          datos.porProducto.slice(0, 20).map((f) => [f.nombre, num(f.unidades), eur(f.importe), eur(f.margen)])
        );
        if (datos.porProducto.length > 20) {
          doc.moveDown(0.2);
          doc.font(F.regular).fontSize(8.5).fillColor(MUTED).text(`y ${datos.porProducto.length - 20} más (todos en el Excel).`);
        }
      }

      if (datos.porMes.length) {
        bloqueTitulo(doc, F, "Por mes");
        tablita(doc, F, ["Mes", "Pedidos", "Unidades", "Importe"], datos.porMes.map((m) => [mes(m.mes), m.pedidos, num(m.unidades), eur(m.importe)]));
      }

      if (datos.porOrigen.length > 1) {
        bloqueTitulo(doc, F, "Por dónde entra");
        tablita(doc, F, ["Origen", "Pedidos", "Importe"], datos.porOrigen.map((o) => [origen(o.origen), o.pedidos, eur(o.importe)]));
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
