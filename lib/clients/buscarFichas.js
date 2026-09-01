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

/**
 * La etiqueta del desplegable: el pagador y, cuando la ficha salió buscando
 * por el NIÑO, también el niño — sin eso el resultado parece un error
 * («busqué a Hugo y me sale Vanesa Muñoz»). El servidor pone `porPaciente`
 * (lib/clients/buscarPorPaciente.js, que es solo de servidor); esta parte es
 * pura y vive aquí porque el navegador la carga.
 */
export function etiquetaDeFicha(ficha) {
  if (!ficha) return "";
  const nombre = ficha.name ?? "";
  return ficha.porPaciente ? `${nombre} — paciente: ${ficha.porPaciente}` : nombre;
}
