/**
 * lib/citas/rotuloBloqueo.js — qué pone en la caja de un bloqueo en la agenda
 * (03/09/2026, Aumenta por Rodrigo).
 *
 * (Fichero nuevo en /lib, regla #2: la caja se pinta en DOS calendarios —el
 * grande y las columnas por terapeuta— y ya divergió una vez; con la regla en
 * un sitio no pueden volver a decir cosas distintas.)
 *
 * ── LA REGLA ────────────────────────────────────────────────────────────────
 * «En los bloqueos solo tiene que poner la categoría en el calendario. Nada de
 * motivo ni la persona: eso solo en el modal del bloqueo.»
 *
 * Hasta hoy la caja decía «Reunión · Preparar sesión · Laura», que en una
 * columna de semana se cortaba a la segunda palabra. La categoría ya lleva su
 * color, y el motivo y de quién es se leen al pulsar. Sin categoría se enseña
 * el motivo, y sin ninguno de los dos, «Bloqueo»: una caja en blanco se lee
 * como un hueco libre, que es justo lo que un bloqueo no es.
 *
 * El clip 📎 se queda: dice que cuelga un documento SIN abrir el tramo, que
 * es para lo que se puso (01/09/2026).
 */

function texto(v) {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * @param {object} b  el bloqueo tal como lo sirve /api/citas/bloqueos
 *   (`categoryLabel`, `label`, `documentos`)
 * @returns {string}
 */
export function rotuloDeBloqueo(b) {
  const base = texto(b?.categoryLabel) || texto(b?.label) || "Bloqueo";
  return base + (Number(b?.documentos) > 0 ? " 📎" : "");
}

/**
 * Lo que sí se lee en el modal: motivo y de quién es, sin la categoría (que
 * ya es el título). `null` si no hay nada que añadir.
 */
export function detalleDeBloqueo(b) {
  const partes = [];
  const motivo = texto(b?.label);
  const categoria = texto(b?.categoryLabel);
  // El motivo solo si el título no lo dice ya: sin categoría, el título ES el
  // motivo (ver `rotuloDeBloqueo`) y repetirlo debajo no informa de nada.
  if (motivo && categoria && motivo !== categoria) partes.push(motivo);
  partes.push(texto(b?.teamMemberName) || "Todo el centro");
  return partes.join(" · ");
}
