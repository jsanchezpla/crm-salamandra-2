/**
 * quienPago — quién pagó cada día con UNA forma de pago, y su descarga
 * (15/09/2026, AV-0137 de Aumenta: «habéis puesto la pestaña de ver quién pagó
 * en efectivo. Necesitamos lo mismo por tarjeta y por banco y que en un momento
 * dado se pueda descargar»).
 *
 * «Efectivo en caja» contesta cuánto QUEDA en el cajón; esto contesta otra
 * cosa, la misma para las tres formas: de quién está hecho lo cobrado. Las
 * cestas son las de `caja.js` (banco = transferencia + domiciliación), así que
 * los totales casan con la columna de «Resumen por día».
 *
 * Funciones puras sobre los `dias` que ya devuelve `/api/arqueo/resumen`.
 */

import { cestaDe } from "./caja.js";

export const FORMAS_PAGO = [
  { clave: "efectivo", label: "Efectivo" },
  { clave: "tarjeta", label: "Tarjeta" },
  { clave: "banco", label: "Banco" },
];

const METODO_LABEL = { cash: "Efectivo", card: "Tarjeta", transfer: "Transferencia", direct_debit: "Domiciliación" };

const redondea = (n) => Math.round(n * 100) / 100;

/**
 * Los días del resumen, cada uno con solo los cobros de esa forma de pago y su
 * suma. Los días sin ninguno se caen: la lista es para repasar, no un calendario.
 */
export function diasPorForma(dias, forma) {
  return (Array.isArray(dias) ? dias : [])
    .map((d) => {
      const cobros = (d.lista ?? []).filter((c) => cestaDe(c.method) === forma);
      return {
        fecha: d.fecha,
        cobros,
        total: redondea(cobros.reduce((s, c) => s + (Number(c.amount) || 0), 0)),
      };
    })
    .filter((d) => d.cobros.length > 0);
}

const sinAcentos = (t) =>
  String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * El buscador por nombre de la pestaña (15/09/2026, AV-0137, Rosa: «directamente
 * desde arqueo poner un buscador por nombre»). Casa con el paciente o con quien
 * paga, sin tildes ni mayúsculas y con TODAS las palabras escritas (en
 * cualquiera de los dos nombres). Rehace la suma de cada día y quita los que se
 * quedan vacíos, así que el total de arriba y la descarga cuentan lo filtrado.
 */
export function filtrarPorNombre(diasFiltrados, texto) {
  const palabras = sinAcentos(texto).split(/\s+/).filter(Boolean);
  if (!palabras.length) return diasFiltrados;
  return (diasFiltrados ?? [])
    .map((d) => {
      const cobros = d.cobros.filter((c) => {
        const donde = sinAcentos(`${c.patientName ?? ""} ${c.clientName ?? ""}`);
        return palabras.every((p) => donde.includes(p));
      });
      return { ...d, cobros, total: redondea(cobros.reduce((s, c) => s + (Number(c.amount) || 0), 0)) };
    })
    .filter((d) => d.cobros.length > 0);
}

/** Total y número de cobros del periodo (las devoluciones restan, no cuentan). */
export function totalPorForma(diasFiltrados) {
  let importe = 0;
  let cobros = 0;
  for (const d of diasFiltrados) {
    importe += d.total;
    cobros += d.cobros.filter((c) => !c.devolucion).length;
  }
  return { importe: redondea(importe), cobros };
}

/** «2026-09-15T08:30:00Z» → «10:30», en Madrid. */
function hora(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });
}

function fecha(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso ?? "");
}

/** Una celda CSV: con `;`, comillas o salto de línea va entre comillas. */
function celda(v) {
  const s = v == null ? "" : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * El CSV de la descarga, pensado para abrirlo con doble clic en el Excel de un
 * centro en España: separador `;`, coma decimal y BOM para que las tildes
 * salgan bien. Una fila por cobro, en orden de día y hora.
 */
export function csvQuienPago(diasFiltrados) {
  const num = (n) => (Number(n) || 0).toFixed(2).replace(".", ",");
  const filas = [["Fecha", "Hora", "Paciente", "Paga", "Forma de pago", "Importe", "Factura", "Mes de la cuota", "Devolución", "Nota"]];
  for (const d of diasFiltrados) {
    for (const c of d.cobros) {
      filas.push([
        fecha(d.fecha),
        hora(c.devolucion ? c.refundedAt ?? c.paidAt : c.paidAt),
        c.patientName ?? "",
        c.clientName ?? "",
        METODO_LABEL[c.method] ?? c.method ?? "",
        num(c.amount),
        c.invoiceNumber ?? "",
        c.periodMonth ?? "",
        c.devolucion ? "Sí" : "",
        c.notes ?? "",
      ]);
    }
  }
  return "﻿" + filas.map((f) => f.map(celda).join(";")).join("\r\n") + "\r\n";
}
