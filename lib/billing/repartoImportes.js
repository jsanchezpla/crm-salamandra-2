/**
 * repartoImportes — cómo se parte un importe entre pagadores sin perder ni
 * inventar un céntimo (31/08/2026).
 *
 * Dos formas, las dos con la misma regla de cierre: se redondea cada parte a
 * céntimos y la ÚLTIMA se lleva la diferencia, para que la suma sea EXACTA al
 * total (la validación del reparto exige cuadrar a ±0,005 €, y «casi cuadra»
 * no vale cuando lo que sale son facturas).
 *
 *   repartoIgual(120, 2)            → [60, 60]        (el botón 50/50)
 *   repartoIgual(100, 3)            → [33.33, 33.33, 33.34]
 *   repartoPorPorcentajes(190, [70, 30]) → [133, 57]
 */
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function repartoIgual(total, n) {
  const t = round2(total);
  const partes = Math.max(1, Math.floor(n) || 1);
  if (!(t > 0)) return Array(partes).fill(0);
  const base = round2(Math.floor((t / partes) * 100) / 100);
  const salida = Array(partes).fill(base);
  salida[partes - 1] = round2(t - base * (partes - 1));
  return salida;
}

export function repartoPorPorcentajes(total, pcts) {
  const t = round2(total);
  const lista = Array.isArray(pcts) ? pcts.map((p) => Number(p) || 0) : [];
  if (!lista.length || !(t > 0)) return lista.map(() => 0);
  const salida = lista.map((p) => round2((t * p) / 100));
  const suma = round2(salida.slice(0, -1).reduce((s, x) => s + x, 0));
  salida[salida.length - 1] = round2(t - suma);
  return salida;
}

/** ¿Los porcentajes suman 100? (con el margen del redondeo al teclear) */
export function porcentajesCuadran(pcts) {
  const suma = (Array.isArray(pcts) ? pcts : []).reduce((s, p) => s + (Number(p) || 0), 0);
  return Math.abs(suma - 100) < 0.01;
}
