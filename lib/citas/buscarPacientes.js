/**
 * lib/citas/buscarPacientes.js — cómo se le pregunta al servidor por pacientes.
 *
 * Hermana de `lib/clients/buscarFichas.js`, y separada de ella porque el
 * endpoint de pacientes NO se llama igual por dentro:
 *
 *   · el parámetro de búsqueda es `q`, no `search`;
 *   · el tope del listado es 300, no 200;
 *   · y acepta `clientId` para quedarse con los de una familia.
 *
 * Equivocarse en el nombre del parámetro no da error: el servidor lo ignora y
 * devuelve los primeros, así que parecería que busca y estaría enseñando
 * cualquier cosa. Por eso vive aquí, en un fichero que se puede probar, y no
 * suelto dentro del componente.
 *
 * No importa nada: lo usa un componente de cliente.
 */

/** Al abrir, sin haber escrito nada. */
export const CUANTOS_AL_ABRIR = 8;

/** Buscando, sin familia: suficientes para reconocer al tuyo de un vistazo. */
export const CUANTOS_AL_BUSCAR = 20;

/**
 * Con familia elegida se piden TODOS los suyos: son uno o dos, y cortarlos
 * sería volver a poner un techo justo donde la lista es corta de verdad.
 */
export const CUANTOS_DE_UNA_FAMILIA = 100;

/**
 * @param {string} texto     lo tecleado (vacío = los últimos)
 * @param {string|null} familia  id de la ficha, para quedarse con sus pacientes
 * @returns {string}
 */
export function urlDePacientes(texto, familia = null) {
  const q = typeof texto === "string" ? texto.trim() : "";
  const p = new URLSearchParams();
  p.set("limit", String(familia ? CUANTOS_DE_UNA_FAMILIA : q ? CUANTOS_AL_BUSCAR : CUANTOS_AL_ABRIR));
  if (q) p.set("q", q);
  if (familia) p.set("clientId", familia);
  return `/api/pacientes?${p.toString()}`;
}
