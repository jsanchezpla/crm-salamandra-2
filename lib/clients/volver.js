/**
 * lib/clients/volver.js — a dónde vuelve la flecha de una ficha.
 *
 * (Motivo del fichero en /lib, regla #2: la flecha está escrita CUATRO veces
 * —dos en la ficha de paciente y dos en la de cliente— y la regla es la misma
 * para las cuatro. Con la decisión repartida por el JSX, arreglar una y olvidar
 * las otras tres es el resultado por defecto: es exactamente lo que ya pasó,
 * porque las cuatro estaban clavadas a su listado. Aquí es una función pura y la
 * fija `scripts/_smoke-clientes-volver.mjs`.)
 *
 * ── DE QUÉ QUEJA NACE (Lau, Aumenta, 14/08/2026) ───────────────────────────
 * «Cada vez que quiero ir de nuevo a FICHAS A COMPLETAR se me va a PACIENTES.»
 * Desde `/clientes/urgentes` se abre una ficha para tapar un hueco de la
 * migración, y al volver aparece el listado general: hay que entrar otra vez por
 * el menú y volver a desplegar la carpeta, que nace cerrada. El gesto se repite
 * decenas de veces seguidas, y son tres clics de más cada una.
 *
 * NO se usa `router.back()`, que sería una línea. El historial del navegador no
 * es de fiar para esto: si la ficha se abre en otra pestaña, se recarga, o se
 * llega por un enlace pegado, `back()` lleva a cualquier sitio o a ninguno. La
 * pantalla de la que vienes es un DATO, así que viaja en el enlace y se lee de
 * la URL, que además sobrevive a recargar.
 */

/**
 * Las pantallas desde las que se puede llegar a una ficha y a las que tiene
 * sentido volver. Lista cerrada A PROPÓSITO: `desde` llega por la URL, o sea
 * que lo escribe quien quiera, y sin lista blanca la flecha sería un salto a
 * donde diga un parámetro.
 */
export const SITIOS_DE_VUELTA = {
  urgentes: { href: "/clientes/urgentes", texto: "Fichas a completar" },
};

/** Una clave de carpeta, no texto libre: viene de la URL como todo lo demás. */
const ES_CARPETA = /^[a-z0-9_-]{1,40}$/i;

/**
 * El enlace de la flecha: `{ href, texto }`.
 *
 * `pordefecto` es a dónde iba antes de todo esto —su listado— y es lo que se
 * devuelve siempre que no haya un `desde` conocido. O sea que una ficha abierta
 * por las bravas se comporta exactamente igual que hasta hoy.
 *
 * Si además viene la carpeta, se devuelve puesta: volver a «Fichas a completar»
 * y encontrársela cerrada obliga a buscar por dónde ibas, que es la mitad de la
 * molestia que se venía a quitar.
 */
export function enlaceDeVuelta(desde, carpeta, pordefecto) {
  const sitio = SITIOS_DE_VUELTA[String(desde ?? "").trim()];
  if (!sitio) return pordefecto;
  const clave = String(carpeta ?? "").trim();
  if (!ES_CARPETA.test(clave)) return { ...sitio };
  return { ...sitio, href: `${sitio.href}?carpeta=${encodeURIComponent(clave)}` };
}

/**
 * La cola que hay que colgarle al enlace de una fila para que la ficha sepa
 * volver. Se escribe aquí y no en la pantalla que enlaza para que el nombre del
 * parámetro esté en un solo sitio: `desde` y `carpeta` los lee `enlaceDeVuelta`,
 * y dos cadenas escritas a mano en dos ficheros distintos se separan a la
 * primera.
 */
export function colaDeVuelta(desde, carpeta) {
  if (!SITIOS_DE_VUELTA[String(desde ?? "").trim()]) return "";
  const clave = String(carpeta ?? "").trim();
  const cola = `?desde=${encodeURIComponent(desde)}`;
  return ES_CARPETA.test(clave) ? `${cola}&carpeta=${encodeURIComponent(clave)}` : cola;
}
