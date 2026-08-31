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
