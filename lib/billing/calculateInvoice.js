/**
 * Calcula totales de una factura con IVA POR LÍNEA.
 *
 * Cada línea de entrada puede traer:
 *   { description, quantity, unitPrice, discountPct, vatRate }
 *
 * Devuelve:
 *   {
 *     lines:   [...] mismas líneas con { lineBase, lineVat, lineTotal } resueltos
 *     taxBase: suma de bases imponibles (sin IVA)
 *     vatAmount: suma de IVA
 *     total:   taxBase + vatAmount
 *     vatBreakdown: agregado por tipo de IVA
 *                   { '21': { base, vat }, '10': { base, vat }, ... }
 *   }
 *
 * Convenciones de redondeo: cada línea redondea a 2 decimales antes de sumar.
 * Esto evita que la suma de líneas y los totales no cuadren por décimas.
 */
export function calculateInvoice({ lines = [], irpfRate = 0 } = {}) {
  const computed = [];
  const breakdown = new Map();

  let taxBase = 0;
  let vatAmount = 0;

  for (const raw of lines) {
    // Apartados con título (31/08/2026): una línea `kind: "titulo"` es un
    // rótulo de sección («Septiembre», «Material»…), no un concepto. Se
    // conserva en su sitio con todo a cero y NO pisa las sumas ni el desglose
    // de IVA — sin este salto, cada título metía una fila «IVA 0 %» de 0 €.
    if (raw.kind === "titulo") {
      computed.push({
        description: String(raw.description ?? ""),
        quantity: 0,
        unitPrice: 0,
        discountPct: 0,
        vatRate: 0,
        lineBase: 0,
        lineVat: 0,
        lineTotal: 0,
        kind: "titulo",
      });
      continue;
    }
    const quantity = Number(raw.quantity ?? 0);
    const unitPrice = Number(raw.unitPrice ?? 0);
    const discountPct = Number(raw.discountPct ?? 0);
    const vatRate = Number(raw.vatRate ?? 0);

    const gross = quantity * unitPrice;
    const lineBase = round2(gross * (1 - discountPct / 100));
    const lineVat = round2(lineBase * (vatRate / 100));
    const lineTotal = round2(lineBase + lineVat);

    const line = {
      description: String(raw.description ?? ""),
      quantity,
      unitPrice: round2(unitPrice),
      discountPct: round2(discountPct),
      vatRate: round2(vatRate),
      lineBase,
      lineVat,
      lineTotal,
    };
    // Preserva refs al catálogo de inventario (descuento de stock al emitir),
    // el flag de transporte (líneas que no tocan stock) y el empleado de la
    // línea (el reparto entre terapeutas de «Por empleado», 31/08/2026).
    if (raw.productId) line.productId = raw.productId;
    if (raw.kind) line.kind = raw.kind;
    if (raw.employeeId) line.employeeId = raw.employeeId;
    computed.push(line);

    taxBase = round2(taxBase + lineBase);
    vatAmount = round2(vatAmount + lineVat);

    const key = String(round2(vatRate));
    const acc = breakdown.get(key) ?? { base: 0, vat: 0 };
    acc.base = round2(acc.base + lineBase);
    acc.vat = round2(acc.vat + lineVat);
    breakdown.set(key, acc);
  }

  // Retención IRPF: se aplica sobre la BASE IMPONIBLE (no sobre el IVA).
  //   total = base + IVA − IRPF
  const irpfPct = round2(Number(irpfRate) || 0);
  const irpfAmount = round2(taxBase * (irpfPct / 100));
  const total = round2(taxBase + vatAmount - irpfAmount);

  const vatBreakdown = {};
  for (const [k, v] of breakdown.entries()) {
    vatBreakdown[k] = v;
  }

  return { lines: computed, taxBase, vatAmount, irpfRate: irpfPct, irpfAmount, total, vatBreakdown };
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}
