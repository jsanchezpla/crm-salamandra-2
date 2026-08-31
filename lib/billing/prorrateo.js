/**
 * prorrateo — la parte proporcional de una cuota cuando la familia empieza a
 * mitad de mes (31/08/2026).
 *
 * La regla de tres de toda la vida, escrita UNA vez: desde el día de inicio
 * (incluido) hasta fin de ese mes, sobre los días reales del mes. Devuelve el
 * desglose entero para que la pantalla pueda ENSEÑAR la cuenta («16 de 30
 * días»), que es lo que evita la llamada de la familia preguntando por el
 * importe raro.
 *
 *   prorrateoDeCuota(190, "2026-09-15") → { importe: 101.33, diasCobrados: 16, diasDelMes: 30, factor: … }
 *
 * Una fecha ilegible devuelve null: el que llama decide qué hacer (la
 * pantalla, no aplicar nada). El importe puede ser negativo (un descuento
 * también se prorratea).
 */
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * rotuloDeProrrateo("2026-09-13") → "desde el 13/09/2026 (18/30 días)".
 * Es la frase que queda ESCRITA (en la línea de la factura, en la nota del
 * cobro) para que la familia entienda el importe raro. Fecha ilegible → null.
 */
export function rotuloDeProrrateo(fechaInicio) {
  const p = prorrateoDeCuota(0, fechaInicio);
  if (!p) return null;
  const [a, m, d] = fechaInicio.split("-");
  return `desde el ${d}/${m}/${a} (${p.diasCobrados}/${p.diasDelMes} días)`;
}

/**
 * partesConProrrateo([{importe, inicio}]) — varios servicios, cada uno con SU
 * fecha de inicio (13/09 logopedia, 17/09 psicología…). `inicio` vacío o
 * ilegible = mes entero. Devuelve cada parte con su importe ya prorrateado y
 * su rótulo, más el total y el total sin prorratear (para enseñar la cuenta).
 */
export function partesConProrrateo(partidas) {
  const partes = (partidas ?? []).map(({ importe, inicio }) => {
    const p = inicio ? prorrateoDeCuota(importe, inicio) : null;
    return {
      importeCompleto: round2(importe),
      importe: p ? p.importe : round2(importe),
      prorrateo: p,
      rotulo: p ? rotuloDeProrrateo(inicio) : null,
    };
  });
  return {
    total: round2(partes.reduce((s, x) => s + x.importe, 0)),
    totalCompleto: round2(partes.reduce((s, x) => s + x.importeCompleto, 0)),
    hayProrrateo: partes.some((x) => x.prorrateo),
    partes,
  };
}

export function prorrateoDeCuota(importe, fechaInicio) {
  if (typeof fechaInicio !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fechaInicio)) return null;
  const [a, m, d] = fechaInicio.split("-").map(Number);
  const diasDelMes = new Date(a, m, 0).getDate(); // día 0 del mes siguiente
  if (!Number.isFinite(diasDelMes) || d < 1 || d > diasDelMes || m < 1 || m > 12) return null;
  const diasCobrados = diasDelMes - d + 1;
  const factor = diasCobrados / diasDelMes;
  return {
    importe: round2(Number(importe) * factor),
    diasCobrados,
    diasDelMes,
    factor,
  };
}
