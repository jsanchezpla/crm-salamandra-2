/**
 * mesesSinPagar — cuántos meses seguidos lleva una familia sin pagar, SIN
 * acusarla de meses en los que el centro aún no cobraba por el CRM
 * (31/08/2026).
 *
 * Nació el día que Aumenta estrenó la caja: con cero cobros registrados, la
 * morosidad pintaba a las 1.083 familias como morosas de 6 meses — el CRM
 * confundía «no ha pagado» con «todavía no se cobra por aquí». La regla:
 *
 *   - se cuenta hacia atrás desde el mes pedido;
 *   - un mes PAGADO corta la cuenta;
 *   - un mes ANTERIOR al primer mes con cobros del centro (`primerMes`)
 *     también la corta: de ahí para atrás no hay verdad que contar.
 *
 * `meses` viene del más reciente al más antiguo (la ventana de la ruta);
 * `pagados` es un Set de 'AAAA-MM'; `primerMes` es 'AAAA-MM' o null (sin
 * cobros en todo el centro — el que llama debe tratarlo ANTES como arranque).
 */
export function mesesSeguidosSinPagar({ meses, pagados, primerMes }) {
  const lista = Array.isArray(meses) ? meses : [];
  const set = pagados instanceof Set ? pagados : new Set(pagados || []);
  let seguidos = 0;
  for (const m of lista) {
    if (set.has(m)) break;
    if (primerMes && m < primerMes) break; // antes de eso, el CRM no cobraba
    seguidos++;
  }
  return seguidos;
}

/**
 * Lo que FALTA de un mes pagado a medias (07/09/2026): `pagado` es la suma
 * de los cobros completados del mes; `esperado`, lo que dicen sus cuotas
 * (null = sin cuotas asignadas: no hay con qué comparar). Devuelve
 * `{ debe, pagado, esperado }` si falta dinero, o null si el mes está
 * cubierto (con un céntimo de margen para el redondeo).
 */
export function loQueFaltaDelMes({ pagado = 0, esperado = null } = {}) {
  const p = Number(pagado) || 0;
  const e = esperado == null ? null : Number(esperado);
  if (e == null || !Number.isFinite(e) || e <= 0) return null;
  const debe = Math.round((e - p) * 100) / 100;
  if (debe <= 0.01) return null;
  return { debe, pagado: Math.round(p * 100) / 100, esperado: Math.round(e * 100) / 100 };
}
