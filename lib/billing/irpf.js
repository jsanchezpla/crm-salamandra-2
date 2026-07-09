/**
 * Ayudas de IRPF para el módulo de facturación.
 *
 * Dos usos distintos del IRPF:
 *
 * 1) RETENCIÓN en facturas emitidas (profesional): el cliente retiene un % de
 *    la base y lo ingresa a Hacienda por ti. Reduce lo que cobras hoy pero es
 *    un pago a cuenta de tu IRPF anual. Lo calcula calculateInvoice.js.
 *
 * 2) DESGRAVACIÓN de gastos deducibles: un gasto deducible reduce tu base
 *    imponible de IRPF, así que "ahorras" IRPF. El ahorro NO es fijo: depende
 *    de tu tipo marginal, que en España va del 19% al 47%. Por cada 100 € de
 *    gasto deducible te ahorras entre 19 € y 47 € de IRPF según tu tramo.
 */

export const IRPF_MARGINAL_MIN = 19; // % — primer tramo
export const IRPF_MARGINAL_MAX = 47; // % — último tramo

function round2(n) { return Math.round(Number(n) * 100) / 100; }

/**
 * Rango de ahorro de IRPF por un gasto deducible de base `base`.
 * Devuelve { min, max } en euros (19% – 47% de la base).
 */
export function irpfDeductionRange(base) {
  const b = Number(base) || 0;
  return {
    min: round2(b * (IRPF_MARGINAL_MIN / 100)),
    max: round2(b * (IRPF_MARGINAL_MAX / 100)),
  };
}
