/**
 * lib/utils/fechaLocal.js — fechas 'AAAA-MM-DD' EN LOCAL y rangos, sin
 * importar nada (03/09/2026).
 *
 * (Fichero nuevo en /lib, regla #2: `rangoFechas.js` las tenía, pero ese
 * fichero importa `apiResponse.js`, que tira de `next/server`, y Node fuera
 * de Next no lo resuelve — las pruebas de `npm test` no pueden cargarlo. Lo
 * puro va aquí; `rangoFechas.js` lo re-exporta y añade lo que necesita Next.)
 */

/**
 * Fecha a 'AAAA-MM-DD' EN LOCAL.
 *
 * `toISOString()` convierte a UTC, y en España eso resta una o dos horas: el 1
 * de julio a las 00:00 se convierte en «30 de junio». Con ese desfase, el
 * periodo empezaba un día antes de lo pedido y la cabecera del PDF mentía
 * sobre sus propias fechas.
 */
export function fechaISO(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/** Rango [desde, hasta] en Date, tolerando strings 'AAAA-MM-DD'. */
export function rangoDe(desde, hasta) {
  const inicio = new Date(`${String(desde).slice(0, 10)}T00:00:00`);
  const fin = new Date(`${String(hasta).slice(0, 10)}T23:59:59`);
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) return null;
  if (inicio > fin) return null;
  return { inicio, fin };
}
