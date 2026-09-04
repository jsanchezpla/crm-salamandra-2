/**
 * notas.js — las dos reglas de la pestaña «Notas» / «Historia clínica» que no
 * son pintura y por eso no viven sueltas en el JSX (04/09/2026, AV-0040 de
 * Laura: «no hay opción de editar la historia clínica, solo borrarla»).
 *
 * La que importa es `fueEditada`: en una historia clínica, saber que una
 * anotación se ha tocado después de escribirla es parte del dato. Si se
 * equivoca por exceso, todas salen «editadas» y la marca deja de significar
 * nada; si se equivoca por defecto, una corrección pasa desapercibida.
 *
 * Las consume `components/clients/ClientNotesPanel.jsx`.
 */

/**
 * Margen entre `createdAt` y `updatedAt` a partir del cual la entrada cuenta
 * como corregida. Al crearla, Sequelize escribe las dos fechas en el mismo
 * INSERT, pero no siempre con el mismo milisegundo; dos segundos separan «se
 * acaba de escribir» de «alguien volvió a ella» sin falsos positivos.
 */
export const MARGEN_EDICION_MS = 2000;

/**
 * ¿Se ha tocado esta entrada después de escribirla?
 *
 * @param {{ createdAt?: string|Date, updatedAt?: string|Date }} nota
 * @returns {boolean}
 */
export function fueEditada(nota) {
  if (!nota?.createdAt || !nota?.updatedAt) return false;
  const creada = new Date(nota.createdAt).getTime();
  const tocada = new Date(nota.updatedAt).getTime();
  if (!Number.isFinite(creada) || !Number.isFinite(tocada)) return false;
  return tocada - creada > MARGEN_EDICION_MS;
}

/**
 * Alto del textarea con el que se corrige una entrada.
 *
 * Las entradas van de dos líneas a una sesión entera; abrir siempre con tres
 * filas obligaría a bajar a ciegas por un texto que ya estaba escrito. Se topa
 * en 24 para que el botón «Guardar cambios» no se vaya de la pantalla.
 *
 * @param {string} texto
 * @returns {number} filas del textarea
 */
export function filasParaEditar(texto) {
  const lineas = String(texto ?? "").split("\n").length;
  return Math.min(24, Math.max(4, lineas + 1));
}
