/**
 * lib/billing/partirFactura.js — partir una factura del lote en varias, sin
 * tocar ningún número ya emitido (06/09/2026, Rodrigo).
 *
 * (Fichero nuevo en /lib, regla #2: es la mitad decidible SIN base de datos
 * —qué cobros van a qué factura nueva, si hay algo que partir, y cómo se
 * anula la original— y así la fija `scripts/_smoke-partir-factura.mjs`. El
 * endpoint `app/api/billing/invoices/[id]/partir` pone las consultas y la
 * transacción alrededor.)
 *
 * ── EL ENCARGO, Y LO QUE NO SE PUEDE HACER ─────────────────────────────────
 * «Facturar el mes» hace una factura por familia; a posteriori quieren
 * revisarla y partirla por hijo o por terapia. Rodrigo pedía elegir entre
 * «poner las extras respetando la numeración» y «mover el número de todas las
 * siguientes». Lo segundo NO es legal: la numeración es correlativa y una
 * factura emitida no cambia de número jamás (Reglamento de facturación; y con
 * Verifactu cada una va encadenada a la anterior). Así que solo hay un camino,
 * y es el que hace esto:
 *
 *   1. La original se ANULA con una rectificativa total (serie R, todo en
 *      negativo), igual que el botón «Rectificar» con base 0.
 *   2. Los MISMOS cobros se reparten en N facturas nuevas —una por paciente o
 *      por terapia— que cogen los números siguientes de la serie F y nacen
 *      cobradas, exactamente como las del lote.
 *
 * El dinero no se mueve: los cobros cambian de factura, no de estado. Y para
 * los KPI el par (original anulada, R) desaparece limpio —`invoiceScope.js`
 * excluye a los dos— y solo cuentan las nuevas, que suman lo mismo.
 */

import { agruparLoteCuotas, agrupacionValida } from "./lotesCuotas.js";

const round2 = (n) => Math.round(Number(n) * 100) / 100;

/** Por qué criterios se puede partir: pagador no tiene sentido (es la original). */
export const CRITERIOS_PARTIR = ["paciente", "terapia"];

export function criterioValido(v) {
  return CRITERIOS_PARTIR.includes(v) ? v : "paciente";
}

/**
 * ¿Se puede partir esta factura, y en qué?
 *
 * @param {object} p
 * @param {object} p.factura   fila plana de Invoice (status, rectifiesInvoiceId, rectifiedByInvoiceId)
 * @param {Array}  p.cobros    los cobros ENGANCHADOS a esa factura (payments.invoice_id)
 * @param {object} p.ficha     el cliente pagador (ATRIBUTOS_PARA_CONGELAR)
 * @param {string} p.por       'paciente' | 'terapia'
 * @param {Array}  p.conceptos [{ id, name }] del catálogo (para 'terapia')
 * @param {Array}  p.pacientes [{ id, name }] de la familia (para 'paciente')
 * @returns {{ ok: boolean, motivo: string|null, grupos: Array, mes: string|null }}
 */
export function planDePartir({ factura, cobros = [], ficha = null, por = "paciente", conceptos = [], pacientes = [] } = {}) {
  const criterio = criterioValido(por);
  const salida = (motivo) => ({ ok: false, motivo, grupos: [], mes: mesDeLosCobros(cobros) });

  if (!factura) return salida("factura no encontrada");
  if (!["issued", "sent", "paid", "partially_paid", "overdue"].includes(factura.status)) {
    return salida(`no se puede partir una factura en estado '${factura.status}'`);
  }
  if (factura.rectifiedByInvoiceId) return salida("esta factura ya está rectificada");
  if (factura.rectifiesInvoiceId) return salida("una rectificativa no se parte");
  // Solo lo que salió del lote de cuotas (o de un partir anterior): una
  // factura manual con cobros asociados no tiene cuotas que repartir, y por
  // la API se podía partir igual (revisión del 06/09/2026).
  if (!factura.customFields?.loteCuotas) return salida("solo se parte una factura emitida por el lote de cuotas");
  if (!cobros.length) return salida("esta factura no tiene cobros de cuota enganchados: no salió del lote y no hay nada que repartir");
  if (cobros.some((c) => c.status !== "completed")) return salida("hay cobros que no están cobrados");
  if (!ficha) return salida("ficha del pagador no encontrada");

  const { facturables, sinNif } = agruparLoteCuotas({
    cobros,
    clientes: [ficha],
    agrupacion: agrupacionValida(criterio),
    conceptos,
    pacientes,
  });
  if (sinNif.length) return salida(sinNif[0].motivo ?? "sin NIF");
  if (facturables.length < 2) {
    return salida(
      criterio === "paciente"
        ? "todos los cobros son del mismo paciente: no hay nada que partir"
        : "todos los cobros son de la misma terapia: no hay nada que partir"
    );
  }
  // La suma de las partes tiene que ser la original al céntimo: si no, algo
  // se ha perdido por el camino y mejor no emitir nada.
  const suma = round2(facturables.reduce((s, g) => s + g.importe, 0));
  const total = round2(Number(factura.total));
  if (suma !== total) return salida(`los cobros suman ${suma} € y la factura es de ${total} €: no cuadra`);

  return { ok: true, motivo: null, grupos: facturables, mes: mesDeLosCobros(cobros) };
}

/** 'AAAA-MM' del mes de cuota de los cobros (el primero manda). */
export function mesDeLosCobros(cobros = []) {
  const p = cobros.find((c) => c?.periodMonth)?.periodMonth;
  if (!p) return null;
  const s = p instanceof Date ? p.toISOString().slice(0, 10) : String(p);
  return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : null;
}

/**
 * Las líneas de la ANULACIÓN total: cada línea de la original en negativo,
 * con su mismo tipo de IVA. Es lo que hace «Rectificar» con base 0 (factor
 * k − 1 = −1), escrito una vez para que el partir y el anular no diverjan.
 */
export function lineasDeAnulacion(factura) {
  const lineas = Array.isArray(factura?.lines) ? factura.lines : [];
  return lineas.map((l) => ({
    description: `Anulación: ${l.description ?? ""}`.trim(),
    quantity: 1,
    unitPrice: round2(-Number(l.lineBase ?? 0)),
    discountPct: 0,
    vatRate: Number(l.vatRate ?? 0),
  }));
}
