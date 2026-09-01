/**
 * lib/billing/totalesGasto.js — el IVA y el total de un gasto (Cost).
 *
 * (Fichero nuevo en /lib, regla #2: mismo motivo que `camposGasto.js`, con el
 * que hace pareja. La fórmula estaba COPIADA literalmente en el POST de
 * `/api/billing/costs` y en el PATCH de `/api/billing/costs/[id]`. Las dos
 * copias eran idénticas carácter a carácter el 20/08/2026, pero nada obligaba a
 * que siguieran siéndolo: el día que una cambie de redondeo, el mismo gasto
 * suma distinto según se dé de alta o se edite, y el Libro IVA y los márgenes
 * heredan la diferencia sin que nada avise.)
 *
 * El cuerpo de la petición NUNCA fija `taxAmount` ni `total` —no están en
 * `CAMPOS_GASTO`—: salen de aquí, siempre, desde la base y el tipo.
 */

/** Céntimos: un importe con más de dos decimales no existe. */
function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Importes de un gasto a partir de la base imponible y el tipo de IVA.
 *
 * `vatRate` nulo es 0 % de IVA, NO el 21 % de fábrica: ese default lo pone el
 * endpoint y solo cuando la clave no viene en el cuerpo.
 *
 * Lo que no es un número sale como `NaN` en vez de convertirse en 0: un gasto
 * sin importe legible tiene que morir en la validación del endpoint o en
 * Postgres, no colarse valiendo cero euros.
 *
 * @param {{ taxBase: any, vatRate: any }} gasto base y tipo, tal cual llegan
 *   del cuerpo o de la fila guardada (los DECIMAL de Sequelize son texto).
 * @returns {{ taxBase: number, vatRate: number, taxAmount: number, total: number }}
 */
export function computeCostTotals({ taxBase, vatRate, irpfRate }) {
  const base = round2(Number(taxBase ?? 0));
  const rate = round2(Number(vatRate ?? 0));
  const taxAmount = round2(base * (rate / 100));
  // Retención de IRPF (31/08/2026): la de la factura del profesional. Resta
  // del total A PAGAR (base + IVA − retención), como en la factura emitida
  // pero al revés — nosotros retenemos y lo ingresamos a Hacienda por él.
  // Sin retención (null/0), todo queda exactamente como siempre.
  const irpf = round2(Number(irpfRate ?? 0));
  const irpfAmount = round2(base * (irpf / 100));
  const total = round2(base + taxAmount - irpfAmount);
  return { taxBase: base, vatRate: rate, taxAmount, irpfRate: irpf, irpfAmount, total };
}
