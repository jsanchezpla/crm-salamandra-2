/**
 * components/admin/tableroTonos.js — de qué color va cada bloque del Registro.
 *
 * Está aparte de la pantalla porque lo miran DOS sitios: el tablero, que pinta
 * los bloques y las tarjetas, y el selector de prioridad, que tiene que pintar
 * sus botones exactamente igual. Si cada uno tuviera su lista, el día que se
 * cambie un color quedaría un botón verde para una prioridad que en la lista se
 * pinta ámbar — y el color aquí no es adorno: es lo que se lee de un vistazo.
 *
 * ── TRES COLORES Y DOS SIN COLOR (24/08/2026, Jorge) ──────────────────────
 * Alta en rojo, media en ámbar, baja en verde. Las otras dos secciones no llevan
 * color a propósito: «Pendiente de una decisión suya» y «Sin comprobar» no son
 * prioridades, son salas de espera, y darles color las metería en la carrera con
 * las que sí esperan turno.
 *
 * Los nombres viejos (P0…P3) se traducen con `seccionDeHoy` antes de buscar, así
 * que el documento publicado hoy —que todavía los lleva— ya se pinta con los
 * colores nuevos sin reescribir una línea de él.
 */

import { seccionDeHoy } from "../../lib/tablero/parser.js";

/** Sin color: el gris de siempre, y sin etiqueta que compita con las tres de arriba. */
const NEUTRO = { color: "var(--tenue)", etiqueta: null };

/**
 * El color y la etiqueta de cada sección del backlog.
 *
 * La etiqueta se enseña cuando se agrupa por CLIENTE, que es cuando la cabecera
 * del bloque ya no dice la prioridad. Agrupando por urgencia, el bloque se
 * titula igual y no hace falta repetirla.
 */
const POR_SECCION = {
  Alta: { color: "var(--alerta)", etiqueta: "alta" },
  Media: { color: "#B45309", etiqueta: "media" },
  Baja: { color: "var(--ok)", etiqueta: "baja" },
  "Pendiente de una decisión suya": { color: "var(--tenue)", etiqueta: "lo decidís vosotros" },
  "Sin comprobar": { color: "var(--tenue)", etiqueta: "sin comprobar" },
};

/**
 * Los dos bloques que se inventa el endpoint para lo que se mueve con el tick.
 * Llevan etiqueta propia para que se vea de un vistazo que eso NO está cerrado en
 * el Registro publicado: está marcado a mano y le falta su publicación.
 */
const INVENTADOS = [
  { casa: /^Marcadas desde el Registro/i, color: "var(--ok)", etiqueta: "sin publicar" },
  { casa: /^Reabiertas desde el Registro/i, color: "#B45309", etiqueta: "reabierta aquí" },
];

export function tonoDe(titulo) {
  const hoy = seccionDeHoy(String(titulo ?? ""));
  if (POR_SECCION[hoy]) return POR_SECCION[hoy];
  return INVENTADOS.find((t) => t.casa.test(hoy)) ?? NEUTRO;
}
