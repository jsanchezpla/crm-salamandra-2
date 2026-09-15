/**
 * lib/billing/importeBuscado.js — ¿lo que se ha escrito en el buscador es un
 * importe? (15/09/2026, AV-0136: Rosa, de Aumenta, quiere buscar cobros y
 * morosos «por importe»).
 *
 * Solo cuenta una palabra que sea ENTERA un número, con coma o punto y hasta dos
 * decimales, y opcionalmente con «€» pegado: «60», «60,5», «60.50», «60€». Un
 * teléfono o un nº de factura no casan porque no son eso («600123456» sí es un
 * número: se busca también como importe, y como no hay cobros de 600 millones
 * no estorba). Los miles con punto («1.200») no se aceptan: son ambiguos con
 * los decimales, y quien busca 1200 lo escribe así.
 *
 * Puro y sin dependencias: lo usan el servidor (Cobros) y el navegador (Morosos).
 */
export function importeBuscado(palabra) {
  const t = String(palabra ?? "").trim().replace(/\s*€$/, "");
  if (!/^\d+([.,]\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t.replace(",", ".")) * 100) / 100;
}

/** ¿Algún importe de la lista es el buscado (al céntimo)? */
export function casaImporte(importes = [], buscado) {
  if (buscado == null) return false;
  return (importes ?? []).some((n) => Math.abs(Number(n) - buscado) < 0.005);
}
