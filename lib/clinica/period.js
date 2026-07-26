/**
 * Parseo/validación de periodos "YYYY-MM" (compartido por las rutas de
 * desempeño/incentivos). Antes cada ruta parseaba con split("-").map(Number)
 * sin validar y un periodo malformado ("julio", "2026") acababa en un 500 de
 * Sequelize (WHERE con NaN/undefined) en vez de un 400 claro.
 *
 * @returns {{year:number, month:number}|null} null si no es un periodo válido.
 */
export function parsePeriodString(raw) {
  if (raw == null || raw === "") return null;
  const m = /^(\d{4})-(\d{1,2})$/.exec(String(raw).trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (year < 2020 || year > 2100 || month < 1 || month > 12) return null;
  return { year, month };
}
