/**
 * pegarCita — dónde cae una cita cortada o copiada (31/08/2026).
 *
 * Del menú contextual de la agenda: «cortar» y «copiar» dejan la cita en un
 * portapapeles y el siguiente clic sobre el calendario la pega. El clic da un
 * `dateStr` CON hora (vistas de semana y día) o SOLO fecha (vista de mes):
 * con hora se pega ahí; solo con fecha, conserva la hora ORIGINAL de la cita
 * en el día elegido — pegar a medianoche porque la vista no daba la hora
 * sería un estropicio silencioso.
 *
 * Corre en el navegador: una fecha sin zona se interpreta en la hora local de
 * quien mira, la misma con la que FullCalendar pinta toda la agenda.
 */
export function destinoDePegado(objetivo, inicioOriginal) {
  if (typeof objetivo !== "string" || !objetivo) return null;
  if (objetivo.includes("T")) {
    const d = new Date(objetivo);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(objetivo)) return null;
  if (typeof inicioOriginal !== "string" || !inicioOriginal.includes("T")) return null;
  const hora = inicioOriginal.slice(11, 19) || "00:00:00";
  const d = new Date(`${objetivo}T${hora}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * La misma regla que decide `startEditable` en el endpoint del calendario:
 * una cita cancelada, completada o con falta ya no se mueve (y tampoco se
 * corta desde el menú — copiarla sí, que repetir una cita pasada es normal).
 */
export function sePuedeMover(status) {
  return status !== "cancelled" && status !== "no_show" && status !== "completed";
}
