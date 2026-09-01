/**
 * lib/billing/lotesCuotas.js — la «Facturación del mes»: de cobros de cuota a
 * facturas.
 *
 * (Fichero nuevo en /lib, regla #2: es la mitad decidible SIN base de datos del
 * lote de emisión masiva —agrupar cobros por pagador, apartar a quien no se le
 * puede facturar y construir líneas cuyo total cuadra con lo cobrado— y así la
 * fija `scripts/_smoke-facturacion-del-mes.mjs` sin levantar nada. El endpoint
 * `app/api/billing/invoices/bulk-issue` solo pone las consultas y la
 * transacción alrededor.)
 *
 * ── EL INVARIANTE QUE LO GOBIERNA TODO ─────────────────────────────────────
 * La factura del lote nace COBRADA: su total tiene que ser exactamente la suma
 * de sus cobros, al céntimo. Si saliera un céntimo por encima quedaría
 * «parcialmente cobrada»; uno por debajo, y el cobro «excedería» el total.
 * Con IVA 0 (el caso de Aumenta: exención sanitaria) es trivial. Con IVA
 * repercutido, la base se busca HACIA ATRÁS desde el total; como el redondeo a
 * céntimos hace que algunos totales no tengan base exacta (a 21 %, entre dos
 * bases consecutivas el total puede saltar 2 céntimos), cuando no la hay se
 * toma la base inmediatamente inferior y la diferencia va en una línea de
 * «Ajuste de redondeo» a IVA 0. El smoke fija los dos caminos.
 */

import { nifDeCliente, nombreFiscalDeCliente } from "./nifCliente.js";

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** ¿Es un mes 'AAAA-MM' de verdad? */
export function mesValido(mes) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(mes ?? ""));
}

/** "2026-09" → "septiembre 2026" (lo que se imprime en la línea de la factura). */
export function mesLegible(mes) {
  if (!mesValido(mes)) return String(mes ?? "");
  const [a, m] = String(mes).split("-").map(Number);
  return `${MESES[m - 1]} ${a}`;
}

/** Primer día del mes SIGUIENTE, 'AAAA-MM-01' — el tope exclusivo de un rango de fechas. */
export function finExclusivoDe(mes) {
  if (!mesValido(mes)) return null;
  const [a, m] = String(mes).split("-").map(Number);
  return m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, "0")}-01`;
}

/**
 * Agrupa los cobros de cuota de un mes en el lote a emitir.
 *
 * @param {object} p
 * @param {Array}  p.cobros   filas planas de Payment (completed, del mes, sin factura):
 *                            { id, clientId, amount, method, paidAt, notes }
 * @param {Array}  p.clientes fichas planas de Client (ATRIBUTOS_PARA_CONGELAR)
 * @param {Array}  p.clientesConFacturaDelMes ids de cliente con alguna factura
 *                            activa emitida ese mes (para AVISAR, no excluir:
 *                            la factura manual de ese mes puede ser de otra cosa)
 * @param {string} p.agrupacion "pagador" (una factura por cliente, lo de
 *                            siempre) o "terapia" (31/08/2026, Rodrigo: una
 *                            factura POR CONCEPTO del catálogo — la terapia va
 *                            en `cobro.conceptId`; los cobros sin concepto, o
 *                            compuestos de varios, no se pueden partir y van
 *                            juntos en un grupo «resto» del mismo pagador)
 * @param {Array}  p.conceptos [{ id, name }] del catálogo, para rotular los
 *                            grupos de terapia
 * @returns {{ facturables: Array, sinNif: Array }}
 *   Cada grupo: { grupoId, clientId, conceptId?, terapia?, nombre, nif,
 *   cobros, importe, facturaPrevia, motivo? }. `grupoId` es la clave para
 *   excluir a mano (con "pagador" es el clientId de siempre).
 *   `sinNif` es la lista de trabajo para recepción: se salta, nunca revienta.
 */
export function agruparLoteCuotas({ cobros = [], clientes = [], clientesConFacturaDelMes = [], agrupacion = "pagador", conceptos = [] } = {}) {
  const fichas = new Map(clientes.map((c) => [String(c.id), c]));
  const conFactura = new Set(clientesConFacturaDelMes.map(String));
  const porTerapia = agrupacion === "terapia";
  const nombresConcepto = new Map(conceptos.map((c) => [String(c.id), c.name]));

  const grupos = new Map();
  for (const cobro of cobros) {
    const cid = String(cobro.clientId ?? "");
    // Un cobro de cuota sin cliente no debería existir (el POST lo exige);
    // si aparece uno, mejor fuera del lote que una factura sin destinatario.
    if (!cid) continue;
    const conceptId = porTerapia && cobro.conceptId ? String(cobro.conceptId) : null;
    const clave = porTerapia ? `${cid}:${conceptId ?? "resto"}` : cid;
    if (!grupos.has(clave)) grupos.set(clave, { cid, conceptId, cobros: [] });
    grupos.get(clave).cobros.push(cobro);
  }

  const facturables = [];
  const sinNif = [];
  for (const [clave, { cid, conceptId, cobros: suyos }] of grupos) {
    suyos.sort((a, b) => String(a.paidAt ?? "").localeCompare(String(b.paidAt ?? "")));
    const ficha = fichas.get(cid) ?? null;
    const grupo = {
      grupoId: clave,
      clientId: cid,
      nombre: ficha ? nombreFiscalDeCliente(ficha) ?? "(sin nombre)" : "(ficha no encontrada)",
      nif: ficha ? nifDeCliente(ficha) : null,
      cobros: suyos,
      importe: round2(suyos.reduce((s, c) => s + Number(c.amount || 0), 0)),
      facturaPrevia: conFactura.has(cid),
    };
    if (porTerapia) {
      grupo.conceptId = conceptId;
      grupo.terapia = conceptId
        ? nombresConcepto.get(conceptId) ?? "(concepto borrado)"
        : "(sin terapia asignada)";
    }
    if (!ficha || !grupo.nif) {
      grupo.motivo = !ficha ? "ficha no encontrada" : "sin NIF";
      sinNif.push(grupo);
    } else {
      facturables.push(grupo);
    }
  }

  const orden = (a, b) =>
    a.nombre.localeCompare(b.nombre, "es") || String(a.terapia ?? "").localeCompare(String(b.terapia ?? ""), "es");
  facturables.sort(orden);
  sinNif.sort(orden);
  return { facturables, sinNif };
}

/**
 * Las líneas de la factura de un grupo: UNA POR COBRO (decisión con Jorge,
 * 31/08/2026 — la factura cuenta qué dinero la compone), construidas para que
 * `calculateInvoice({ lines, irpfRate: 0 }).total` sea EXACTAMENTE la suma de
 * los cobros. El IRPF va a 0 a propósito: la retención es de facturas
 * profesionales entre empresas, y una cuota cobrada a una familia no retiene —
 * y con retención el total ya no cuadraría con lo cobrado.
 */
export function lineasDeCuota({ cobros = [], mes, vatRate = 0 } = {}) {
  const tipo = round2(Number(vatRate) || 0);
  const etiqueta = `Cuota ${mesLegible(mes)}`;
  const lines = [];
  let resto = 0;

  for (const cobro of cobros) {
    const importe = round2(Number(cobro.amount || 0));
    const nota = String(cobro.notes ?? "").trim();
    const description = nota ? `${etiqueta} — ${nota}` : etiqueta;
    if (tipo === 0) {
      lines.push({ description, quantity: 1, unitPrice: importe, vatRate: 0 });
      continue;
    }
    const base = baseParaTotal(importe, tipo);
    if (base != null) {
      lines.push({ description, quantity: 1, unitPrice: base, vatRate: tipo });
    } else {
      const abajo = mayorBaseNoSuperior(importe, tipo);
      lines.push({ description, quantity: 1, unitPrice: abajo, vatRate: tipo });
      resto = round2(resto + round2(importe - totalConIva(abajo, tipo)));
    }
  }

  if (resto !== 0) {
    lines.push({ description: "Ajuste de redondeo", quantity: 1, unitPrice: resto, vatRate: 0 });
  }
  return lines;
}

// El total de una línea (cantidad 1, sin descuento) con los MISMOS redondeos
// que `calculateInvoice`: base a céntimos, IVA a céntimos, suma a céntimos.
function totalConIva(base, tipo) {
  const b = round2(base);
  return round2(b + round2(b * (tipo / 100)));
}

// La base cuyo total con IVA da exactamente `total`, o null si no existe
// (el redondeo hace saltar el total 2 céntimos entre bases consecutivas).
function baseParaTotal(total, tipo) {
  const aprox = round2(total / (1 + tipo / 100));
  for (let k = -2; k <= 2; k++) {
    const base = round2(aprox + k / 100);
    if (base >= 0 && totalConIva(base, tipo) === total) return base;
  }
  return null;
}

// La mayor base cuyo total con IVA NO supera `total` (para que el ajuste de
// redondeo sea siempre positivo).
function mayorBaseNoSuperior(total, tipo) {
  const aprox = round2(total / (1 + tipo / 100));
  let mejor = 0;
  for (let k = -3; k <= 3; k++) {
    const base = round2(aprox + k / 100);
    if (base >= 0 && totalConIva(base, tipo) <= total && base > mejor) mejor = base;
  }
  return mejor;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}
