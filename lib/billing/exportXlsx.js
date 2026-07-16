import ExcelJS from "exceljs";
import { contentDisposition } from "@/lib/documents/helpers.js";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const LINK_FONT = { color: { argb: "FF2563EB" }, underline: true };

// Formatos de celda (numFmt de Excel). Los importes/porcentajes se guardan como
// NÚMERO y se formatean aquí (así el usuario puede operar en Excel).
export const MONEY_FMT = '#,##0.00" €"';
export const PCT_FMT = '0.00" %"';
export const INT_FMT = "#,##0";

/** Fecha en es-ES (DD/MM/YYYY) como texto; "—" si falta. */
export function fmtDateEs(d) {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d.length <= 10 ? d + "T00:00:00" : d) : new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString("es-ES");
}

/**
 * Construye una respuesta XLSX descargable (mismo patrón que el Libro IVA):
 * una hoja "Datos" con cabecera en negrita + fila congelada, y una hoja opcional
 * "Filtros aplicados". Devuelve un Response listo para el route handler.
 *
 *   columns: [{ header, key, width?, numFmt?, link? }]  // link:true => celda-hipervínculo
 *   rows:    array de objetos { key: value }. Para una celda-enlace, el valor es
 *            { text: "FAC-0001", hyperlink: "https://…/pdf" } (ExcelJS nativo).
 *   filters: [{ label, value }] para la hoja "Filtros aplicados" (opcional).
 */
export async function xlsxResponse({ filename, sheetName = "Datos", columns, rows, filters }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Salamandra CRM";
  wb.created = new Date();

  const ws = wb.addWorksheet(sheetName);
  ws.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width ?? 18,
    style: c.numFmt ? { numFmt: c.numFmt } : undefined,
  }));

  const linkKeys = new Set(columns.filter((c) => c.link).map((c) => c.key));
  for (const rowData of rows) {
    const row = ws.addRow(rowData);
    // Estilo azul+subrayado a las celdas que son hipervínculo (ExcelJS no lo hace solo).
    for (const key of linkKeys) {
      const cell = row.getCell(key);
      if (cell && cell.value && typeof cell.value === "object" && cell.value.hyperlink) {
        cell.font = LINK_FONT;
      }
    }
  }

  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  if (Array.isArray(filters) && filters.length) {
    const fs = wb.addWorksheet("Filtros aplicados");
    fs.columns = [
      { header: "Filtro", key: "label", width: 28 },
      { header: "Valor", key: "value", width: 44 },
    ];
    for (const f of filters) fs.addRow({ label: f.label, value: f.value ?? "—" });
    fs.getRow(1).font = { bold: true };
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": XLSX_MIME,
      "Content-Disposition": contentDisposition("attachment", filename),
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Base URL absoluta del tenant a partir de la request (respeta host/subdominio con
 * el que accede cada tenant). Para construir hipervínculos a los PDF.
 */
export function baseUrlFrom(request) {
  try {
    return new URL(request.url).origin;
  } catch {
    return "";
  }
}
