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
 */
export function parseSortOrder(sortBy, sortDir, allowed, fallback) {
  const dir = String(sortDir || "").toLowerCase() === "asc" ? "ASC" : "DESC";
  const def = allowed[sortBy];
  if (def == null) return fallback;
  if (typeof def === "string") return [[def, dir]];
  if (Array.isArray(def)) return [[...def, dir]];
  return fallback;
}
