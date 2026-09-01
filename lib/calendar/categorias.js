/**
 * lib/calendar/categorias.js — el catálogo de categorías del Calendario.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten los dos endpoints del
 * catálogo y el que resuelve la categoría al guardar un evento, y las reglas
 * tienen que ser las mismas en los tres.)
 *
 * Aquí vive lo que se puede afirmar sobre una categoría sin tocar la base:
 * qué campos se aceptan del cuerpo de una petición, cómo se normalizan y qué
 * color se usa para pintar. Se prueba con `node:test` sin Sequelize ni Next.
 */

const HEX = /^#[0-9a-f]{6}$/i;
const MAX_NOMBRE = 80;
const MAX_DESCRIPCION = 500;

/**
 * La paleta que se ofrece al crear una categoría. Son colores que se leen bien
 * sobre blanco y se distinguen entre sí de un vistazo en una rejilla mensual;
 * no son los de prioridad (rojo/naranja/verde) a propósito, para que las dos
 * formas de colorear el calendario no se confundan.
 */
export const PALETA_CATEGORIAS = [
  "#3F6E5B", // verde salamandra
  "#2563EB", // azul
  "#7C3AED", // morado
  "#DB2777", // frambuesa
  "#EA580C", // naranja quemado
  "#0891B2", // turquesa
  "#65A30D", // oliva
  "#B45309", // ámbar oscuro
  "#475569", // pizarra
  "#BE123C", // granate
];

/** El color con el que se pinta esta categoría, o null si no tiene. */
export function colorDeCategoria(categoria) {
  const c = categoria?.color;
  return typeof c === "string" && HEX.test(c.trim()) ? c.trim().toUpperCase() : null;
}

function texto(valor, max) {
  if (typeof valor !== "string") return "";
  return valor.trim().slice(0, max);
}

/**
 * Valida y normaliza el cuerpo de un alta o una edición de categoría.
 *
 * `creando` distingue las dos: al crear, el nombre es obligatorio; al editar
 * solo se tocan las claves que VIENEN en el cuerpo (así el interruptor de
 * «activa» de la tabla no tiene que reenviar el color y la descripción).
 *
 * @returns {{ valores: object, error: string|null }}
 */
export function normalizarCategoria(body, { creando = false } = {}) {
  const valores = {};
  const cuerpo = body && typeof body === "object" ? body : {};

  if (creando || "name" in cuerpo) {
    const name = texto(cuerpo.name, MAX_NOMBRE);
    if (!name) return { valores: {}, error: "El nombre de la categoría es obligatorio" };
    valores.name = name;
  }

  if ("description" in cuerpo) {
    valores.description = texto(cuerpo.description, MAX_DESCRIPCION) || null;
  }

  if (creando || "color" in cuerpo) {
    const bruto = typeof cuerpo.color === "string" ? cuerpo.color.trim() : "";
    if (bruto && !HEX.test(bruto)) {
      return { valores: {}, error: "El color tiene que ser un hexadecimal tipo #3F6E5B" };
    }
    // Sin color elegido se coge el primero de la paleta: una categoría sin
    // color no se distingue de otra y el modo «por categoría» no serviría.
    valores.color = bruto ? bruto.toUpperCase() : creando ? PALETA_CATEGORIAS[0] : null;
  }

  if ("active" in cuerpo) valores.active = cuerpo.active !== false;

  if ("order" in cuerpo) {
    const n = Number(cuerpo.order);
    valores.order = Number.isFinite(n) ? Math.trunc(n) : 0;
  }

  return { valores, error: null };
}
