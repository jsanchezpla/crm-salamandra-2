/**
 * lib/utils/ficherosSoltados.js — qué se acepta cuando alguien SUELTA ficheros
 * encima de una zona.
 *
 * (Fichero en /lib, regla #2. El motivo: al pinchar en un `<input type="file">`
 * el navegador ya filtra por su `accept` y solo enseña lo que vale. Al soltar,
 * NO: llega cualquier cosa, y sin este filtro un PDF soltado sobre la zona del
 * audio se quedaría guardado como si fuera la grabación de la sesión. La regla
 * tiene que estar en un sitio con nombre y con prueba, no repartida por el JSX
 * de cada pantalla.)
 *
 * ── DE DÓNDE SALE (28/08/2026, Lau de Aumenta) ─────────────────────────────
 * El audio de la sesión le llega por WhatsApp, lo descarga y le queda a la
 * vista en la barra de descargas del navegador. Pero «Añadir audio» abre el
 * explorador de Windows, así que tiene que ir a buscar en Descargas el fichero
 * que ya tiene delante. Pidió poder arrastrarlo directamente.
 *
 * El CRM ya sabía soltar ficheros en tres sitios (Documentos, adjuntos de una
 * ficha y el importador de Leads), pero cada uno con su copia de la misma
 * lógica y ninguno filtraba por tipo. Esto es la parte que se puede probar.
 */

/**
 * ¿Encaja este fichero con el `accept` de un input?
 *
 * Entiende las tres formas del atributo, que es justo lo que usan las pantallas:
 * extensión (`.ogg`), familia (`audio/*`) y tipo exacto (`application/pdf`).
 *
 * Se mira el nombre ADEMÁS del tipo a propósito: hay ficheros que llegan con
 * `type` vacío —según el sistema y de dónde se arrastren—, y una nota de voz de
 * WhatsApp que se llama `.ogg` es un audio aunque el navegador no sepa decirlo.
 *
 * @param {File} file
 * @param {string} accept  el mismo string que el atributo `accept` del input
 * @returns {boolean}  sin `accept`, todo vale
 */
export function aceptaFichero(file, accept) {
  const reglas = String(accept ?? "")
    .split(",")
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean);
  if (reglas.length === 0) return true;

  const nombre = String(file?.name ?? "").toLowerCase();
  const tipo = String(file?.type ?? "").toLowerCase();

  return reglas.some((regla) => {
    if (regla.startsWith(".")) return nombre.endsWith(regla);
    if (regla.endsWith("/*")) return tipo.startsWith(regla.slice(0, -1));
    return tipo !== "" && tipo === regla;
  });
}

/**
 * Reparte lo que se ha soltado en lo que vale y lo que no.
 *
 * Devuelve los dos lados porque la pantalla necesita los DOS: los buenos para
 * quedárselos y los malos para poder decir «esto no es un audio» en vez de
 * tragárselos en silencio, que es lo que hace que alguien piense que el CRM ha
 * perdido su fichero.
 *
 * @param {FileList|File[]} lista
 * @param {string} accept
 * @returns {{aceptados: File[], rechazados: File[]}}
 */
export function repartirSoltados(lista, accept) {
  const aceptados = [];
  const rechazados = [];
  for (const file of Array.from(lista ?? [])) {
    if (aceptaFichero(file, accept)) aceptados.push(file);
    else rechazados.push(file);
  }
  return { aceptados, rechazados };
}

/** Frase para el aviso cuando se suelta algo que no vale. */
export function avisoDeRechazo(rechazados, queSeEspera) {
  const nombres = (rechazados ?? []).map((f) => f?.name).filter(Boolean);
  if (nombres.length === 0) return null;
  const lista = nombres.slice(0, 3).join(", ") + (nombres.length > 3 ? `, y ${nombres.length - 3} más` : "");
  return `${lista}: aquí solo se puede soltar ${queSeEspera}.`;
}
