import { Op, fn, col } from "sequelize";

/**
 * Construye el Libro de IVA + estimación de Modelo 303 para un periodo.
 *
 * Recibe:
 *   { tenantModels, from, to }   con from/to en formato YYYY-MM-DD
 *
 * Devuelve:
 *   {
 *     period: { from, to },
 *     output: {     // IVA repercutido (ventas)
 *       byRate: [{ vatRate, base, vat, count }],
 *       totals: { base, vat },
 *       invoices: [{ id, number, issueDate, clientName, base, vat, total, lines: [...] }]
 *     },
 *     input: {      // IVA soportado deducible (compras)
 *       byRate: [{ vatRate, base, vat, count }],
 *       totals: { base, vat },
 *       costs: [{ id, description, incurredAt, vatRate, taxBase, vatAmount, total, vatDeductible }]
 *     },
 *     model303: {
 *       outputVat: number,
 *       deductibleInputVat: number,
 *       difference: number,        // positivo = a pagar a Hacienda; negativo = a devolver/compensar
 *     }
 *   }
 */
export async function buildIvaReport({ tenantModels, from, to }) {
  const { Invoice, Cost, Client } = tenantModels;

  // ── Facturas emitidas en el periodo (excluye draft, cancelled y rectified)
  const invoices = await Invoice.findAll({
    where: {
      issueDate: { [Op.between]: [from, to] },
      status: { [Op.notIn]: ["draft", "cancelled", "rectified"] },
    },
    include: [{ model: Client, as: "client", attributes: ["id", "name", "fiscalName", "taxId"] }],
    order: [["issueDate", "ASC"], ["number", "ASC"]],
  });

  // ── Costes (IVA soportado) en el periodo, filtrados por incurred_at ────
  const costs = await Cost.findAll({
    where: { incurredAt: { [Op.between]: [from, to] } },
    order: [["incurredAt", "ASC"]],
  });

  // ── Output (IVA repercutido) — agregar por tipo desde las líneas ───────
  const outputByRate = new Map();
  const outputInvoices = [];

  for (const inv of invoices) {
    const lines = Array.isArray(inv.lines) ? inv.lines : [];
    const lineBreakdown = aggregateLinesByRate(lines);
    let invBase = 0;
    let invVat = 0;
    for (const [rate, agg] of lineBreakdown.entries()) {
      const acc = outputByRate.get(rate) ?? { base: 0, vat: 0, count: 0 };
      acc.base = round2(acc.base + agg.base);
      acc.vat = round2(acc.vat + agg.vat);
      acc.count += 1;
      outputByRate.set(rate, acc);
      invBase = round2(invBase + agg.base);
      invVat = round2(invVat + agg.vat);
    }

    outputInvoices.push({
      id: inv.id,
      number: inv.number,
      issueDate: inv.issueDate,
      clientName: inv.client?.fiscalName || inv.client?.name || null,
      clientTaxId: inv.client?.taxId ?? null,
      base: invBase,
      vat: invVat,
      total: round2(invBase + invVat),
      lines,
    });
  }

  const outputTotals = sumTotals(outputByRate);

  // ── Input (IVA soportado deducible) ────────────────────────────────────
  const inputByRate = new Map();
  const inputCosts = [];

  for (const c of costs) {
    const taxBase = Number(c.taxBase);
    const taxAmount = Number(c.taxAmount);
    const vatRate = Number(c.vatRate);
    const isDeductible = !!c.vatDeductible;

    if (isDeductible && taxAmount > 0) {
      const key = String(round2(vatRate));
      const acc = inputByRate.get(key) ?? { base: 0, vat: 0, count: 0 };
      acc.base = round2(acc.base + taxBase);
      acc.vat = round2(acc.vat + taxAmount);
      acc.count += 1;
      inputByRate.set(key, acc);
    }

    inputCosts.push({
      id: c.id,
      description: c.description,
      incurredAt: c.incurredAt,
      vatRate,
      taxBase,
      vatAmount: taxAmount,
      total: Number(c.total),
      vatDeductible: isDeductible,
    });
  }

  const inputTotals = sumTotals(inputByRate);

  // ── Modelo 303 ─────────────────────────────────────────────────────────
  const outputVat = round2(outputTotals.vat);
  const deductibleInputVat = round2(inputTotals.vat);
  const difference = round2(outputVat - deductibleInputVat);

  return {
    period: { from, to },
    output: {
      byRate: mapToRateArray(outputByRate),
      totals: outputTotals,
      invoices: outputInvoices,
    },
    input: {
      byRate: mapToRateArray(inputByRate),
      totals: inputTotals,
      costs: inputCosts,
    },
    model303: {
      outputVat,
      deductibleInputVat,
      difference,
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function aggregateLinesByRate(lines) {
  const out = new Map();
  for (const line of lines) {
    const rate = round2(Number(line.vatRate ?? 0));
    const base = Number(line.lineBase ?? 0);
    const vat = Number(line.lineVat ?? 0);
    const acc = out.get(String(rate)) ?? { base: 0, vat: 0 };
    acc.base = round2(acc.base + base);
    acc.vat = round2(acc.vat + vat);
    out.set(String(rate), acc);
  }
  return out;
}

function sumTotals(map) {
  let base = 0;
  let vat = 0;
  for (const v of map.values()) {
    base = round2(base + v.base);
    vat = round2(vat + v.vat);
  }
  return { base, vat };
}

function mapToRateArray(map) {
  return [...map.entries()]
    .map(([rate, agg]) => ({ vatRate: Number(rate), ...agg }))
    .sort((a, b) => b.vatRate - a.vatRate);
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}
