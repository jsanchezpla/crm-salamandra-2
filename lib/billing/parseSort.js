/**
 * Convierte ?sortBy=&sortDir= en un array `order` válido de Sequelize,
 * con whitelist obligatorio para evitar inyección via nombre de columna.
 *
 * `allowed` es un mapa { sortByDelClient → definición Sequelize }:
 *   - string: nombre de columna directo, ej. "issueDate"
 *   - array: include anidado, ej. [{ model: Client, as: "client" }, "name"]
 *
 * Si el sortBy no está en el mapa, devuelve `fallback` (array order
 * por defecto del endpoint, ej. [["issueDate", "DESC"]]).
 *
 * ── EL DESEMPATE (18/09/2026, AV-0176) ──────────────────────────────────────
 * Isabel: «¿por qué no salen correlativas en el buscador?». La lista de
 * facturas ordena por fecha, y las 229 facturas de septiembre de Aumenta
 * comparten fecha de emisión: con una sola clave, Postgres devuelve los empates
 * en el orden que le apetece, y el listado salía C2602117, 116, 123, 115, 114,
 * 097… El `fallback` de ese endpoint SÍ llevaba `["number", "DESC"]` detrás,
 * pero solo se usaba cuando el `sortBy` no estaba en el mapa: en cuanto la
 * pantalla pedía `issueDate` —que es lo que pide siempre— el desempate se
 * perdía. Por eso ahora se pasa aparte y se pega SIEMPRE, salvo que ya se esté
 * ordenando por esa misma columna.
 */
export function parseSortOrder(sortBy, sortDir, allowed, fallback, desempate = []) {
  const dir = String(sortDir || "").toLowerCase() === "asc" ? "ASC" : "DESC";
  const def = allowed[sortBy];
  if (def == null) return fallback;
  const clave = typeof def === "string" ? [[def, dir]] : Array.isArray(def) ? [[...def, dir]] : null;
  if (clave == null) return fallback;
  return [...clave, ...desempateQueFalta(clave, desempate)];
}

/** El desempate, menos las columnas por las que ya se está ordenando. */
function desempateQueFalta(clave, desempate) {
  if (!Array.isArray(desempate) || desempate.length === 0) return [];
  const yaOrdenadas = new Set(clave.map(([col]) => (typeof col === "string" ? col : null)).filter(Boolean));
  return desempate.filter(([col]) => typeof col !== "string" || !yaOrdenadas.has(col));
}
