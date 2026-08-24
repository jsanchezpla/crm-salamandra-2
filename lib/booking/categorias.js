/**
 * lib/booking/categorias.js — de qué tipo es un contratante.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten la pantalla de Contratantes,
 * el importador y mañana los filtros del embudo. Una lista de tipos escrita en
 * el JSX es una lista que el importador no puede validar.)
 *
 * ── POR QUÉ HACE FALTA ─────────────────────────────────────────────────────
 * Rodrigo, 24/08/2026: «no queda bien separado si es industria, si es manager o
 * si es sala ni nada». Tenía razón: los 210 contactos entraron con un `sector`
 * de texto libre heredado de Captación —«Industria · Prensa y radio»,
 * «Prensa · Blogs y webs»— que servía para leer pero no para filtrar, y que
 * mezclaba dos ejes distintos (de dónde salió el contacto y qué es).
 *
 * Aquí solo se declara QUÉ ES, que es lo único que cambia cómo se le escribe:
 * a un ayuntamiento se le manda un presupuesto con IVA y a una revista una nota
 * de prensa.
 *
 * ── DÓNDE SE GUARDA ────────────────────────────────────────────────────────
 * En `Client.customFields.categoria`. No es una columna porque solo la usan los
 * clientes con módulo `booking`, y añadir una columna a `clients` —que tienen
 * los once tenants— para algo de uno sería cobrarle a todos el sitio.
 */

/**
 * `contrata` = de los que sale un bolo y un caché. Es lo que separa el embudo
 * de contratación del de prensa: a un medio no se le manda un presupuesto.
 */
export const CATEGORIAS = [
  { key: "festival", label: "Festival", contrata: true },
  { key: "sala", label: "Sala / club", contrata: true },
  { key: "ayuntamiento", label: "Ayuntamiento", contrata: true },
  { key: "ciclo", label: "Ciclo / programación", contrata: true },
  { key: "promotora", label: "Promotora / agencia", contrata: true },
  { key: "medio", label: "Medio / revista", contrata: false },
  { key: "radio", label: "Radio", contrata: false },
  { key: "tv", label: "Televisión", contrata: false },
  { key: "manager", label: "Mánager", contrata: false },
  { key: "discografica", label: "Discográfica", contrata: false },
  { key: "otro", label: "Otro", contrata: false },
];

const POR_CLAVE = new Map(CATEGORIAS.map((c) => [c.key, c]));

export const CLAVES_CATEGORIA = CATEGORIAS.map((c) => c.key);

export function categoriaValida(k) {
  return POR_CLAVE.has(String(k || ""));
}

/** El rótulo humano, o la clave en crudo si alguien metió una a mano. */
export function rotuloCategoria(k) {
  return POR_CLAVE.get(String(k || ""))?.label ?? (k || "—");
}

/** ¿De esta categoría sale un bolo? Usado para separar booking de prensa. */
export function categoriaContrata(k) {
  return POR_CLAVE.get(String(k || ""))?.contrata ?? false;
}

/** Las que contratan, para filtrar el embudo sin escribir la lista otra vez. */
export function categoriasQueContratan() {
  return CATEGORIAS.filter((c) => c.contrata).map((c) => c.key);
}
