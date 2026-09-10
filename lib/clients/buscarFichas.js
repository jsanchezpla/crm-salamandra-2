/**
 * lib/clients/buscarFichas.js — cómo se le pregunta al servidor por fichas.
 *
 * Una sola regla, dos pantallas con formas distintas: el desplegable
 * (`components/clients/SelectorCliente.jsx`, que lo usan once sitios) y la
 * lista con buscador de «Nuevo ticket» (`modules/support/NewTicketModal.jsx`).
 * Cada una se pinta como le conviene; lo que NO puede haber es dos ideas de
 * cuántas se piden, cómo se llama el parámetro o cuánto se espera al teclear.
 *
 * No importa nada: lo usan componentes de cliente.
 */

/** Al abrir, sin haber escrito nada: unas pocas, para no recibir con un hueco. */
export const CUANTAS_AL_ABRIR = 8;

/** Buscando: suficientes para reconocer a la tuya de un vistazo. */
export const CUANTAS_AL_BUSCAR = 20;

/** Lo que se espera antes de preguntar, para no hacerlo en cada tecla. */
export const ESPERA_MS = 300;

/**
 * La dirección a la que preguntar.
 *
 * @param {string} texto   lo tecleado (vacío = las últimas)
 * @param {object} [params] filtros extra, p.ej. { assignedTo: "nutricion" }
 * @param {string} [base]  qué buscador contesta. El general es /api/clients;
 *   las pantallas de facturación preguntan a /api/billing/fichas, que abre con
 *   el módulo `billing` (Rosa y Olga cobran sin tener `clients` — 31/08/2026).
 * @returns {string}
 */
export function urlDeFichas(texto, params = null, base = "/api/clients") {
  const q = typeof texto === "string" ? texto.trim() : "";
  const p = new URLSearchParams();
  p.set("limit", String(q ? CUANTAS_AL_BUSCAR : CUANTAS_AL_ABRIR));
  if (q) p.set("search", q);
  for (const [k, v] of Object.entries(params || {})) {
    if (v != null && v !== "") p.set(k, String(v));
  }
  return `${base}?${p.toString()}`;
}

/**
 * ¿Hay más de las que se están enseñando? Es lo que convierte un techo callado
 * en un aviso: sin esto, una familia que no cabe se lee igual que una que no
 * existe. `total` es cuántas casan en TODA la base, no cuántas se bajaron.
 */
export function hayMasDeLasQueCaben(total, enseñadas) {
  return Number(total) > Number(enseñadas);
}

/** Cuántos hermanos caben en una línea antes de contarlos. */
export const PACIENTES_EN_LA_ETIQUETA = 2;

/**
 * Quién viene a consulta en esta ficha, para pintarlo delante del pagador.
 *
 * Dos fuentes y un orden: si la ficha salió buscando por un paciente, ese es el
 * que se enseña (`porPaciente`, una cadena) — es el que explica por qué está
 * ahí esa familia. Si no, los pacientes de la ficha tal y como los trae el
 * servidor (`pacientes`, ya ordenados con los que siguen viniendo delante).
 *
 * Devuelve nombres, nunca objetos, y siempre un array.
 */
export function pacientesDeLaEtiqueta(ficha) {
  if (!ficha) return [];
  if (ficha.porPaciente) return [String(ficha.porPaciente)];
  const lista = Array.isArray(ficha.pacientes) ? ficha.pacientes : [];
  return lista
    .map((p) => (typeof p === "string" ? p : p?.nombre ?? ""))
    .map((n) => String(n).trim())
    .filter(Boolean);
}

/**
 * Cómo se lee una ficha en un buscador: **primero el paciente y después quien
 * paga** (01/09/2026, Rodrigo; y en todos los buscadores desde el 10/09/2026).
 *
 * El orden importa y ya cambió una vez. Sin el niño, el resultado parecía un
 * error («busqué a Hugo y me sale Vanesa Muñoz»), así que se añadió detrás:
 * «Vanesa Muñoz — paciente: Hugo Castro». Pero quien cobra escribe el nombre
 * del niño y busca ese nombre con la vista: leerlo al final de cada línea, con
 * veinte líneas que empiezan por apellidos distintos, es justo el trabajo que
 * el buscador tenía que ahorrar. Delante el niño, la lista se lee de un
 * vistazo.
 *
 * Desde el 10/09/2026 el niño sale TAMBIÉN cuando la ficha se ha encontrado por
 * el apellido de la familia: el servidor manda los pacientes de cada ficha
 * (lib/clients/pacientesDeLaFamilia.js) y no solo el que hizo la coincidencia.
 * Con hermanos caben dos y el resto se cuenta, que una línea de desplegable no
 * da para cuatro nombres.
 *
 * Dos funciones porque hay dos formas de pintarlo: `rotuloDePacientes` da solo
 * la parte de los niños («Hugo Castro», «Hugo · Marta +1») para quien los pone
 * en su propia línea —el buscador del alta de cita—, y `etiquetaDeFicha` la
 * línea entera para los desplegables.
 *
 * Esta parte es pura y vive aquí porque la carga el navegador; quien reúne los
 * datos es el servidor (`porPaciente` y `pacientes`).
 */
export function rotuloDePacientes(ficha) {
  const pacientes = pacientesDeLaEtiqueta(ficha);
  if (!pacientes.length) return "";
  const visibles = pacientes.slice(0, PACIENTES_EN_LA_ETIQUETA);
  const resto = pacientes.length - visibles.length;
  return visibles.join(" · ") + (resto > 0 ? ` +${resto}` : "");
}

export function etiquetaDeFicha(ficha) {
  if (!ficha) return "";
  const nombre = ficha.name ?? "";
  const quienes = rotuloDePacientes(ficha);
  if (!quienes) return nombre;
  return nombre ? `${quienes} — ${nombre}` : quienes;
}
