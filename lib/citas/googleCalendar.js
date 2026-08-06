/**
 * El enlace de «Añadir a Google Calendar» de una cita.
 *
 * ── POR QUÉ SALE DEL WIDGET A /lib (06/08/2026, Rodrigo) ────────────────────
 * Vivía dentro de la pantalla de reserva y solo se veía ahí: ni en el área
 * privada ni en el correo. Eso ya era raro, y desde que una cita puede nacer
 * PENDIENTE del visto bueno de la profesional se volvió un agujero: en esa
 * pantalla el enlace no se pinta (apuntar en la agenda una hora que aún no es
 * suya es pedirle que se presente a algo que puede no existir), así que a quien
 * se la confirmaban después no le quedaba NINGUNA forma de llevársela a su
 * calendario. Se saca aquí para que lo usen los tres sitios.
 *
 * Formato de fechas de Google: UTC compacto, `YYYYMMDDTHHMMSSZ`.
 */

function utcCompacto(fecha) {
  return new Date(fecha).toISOString().replace(/[-:]|\.\d{3}/g, "");
}

/**
 * @param {{ name: string, description?: string, start: string|Date,
 *           durationMinutes?: number, location?: string }} cita
 * @returns {string|null} null si no hay fecha con la que construirlo.
 */
export function googleCalendarUrl({ name, description = "", start, durationMinutes = 60, location = "" }) {
  if (!start) return null;
  const inicio = new Date(start);
  if (Number.isNaN(inicio.getTime())) return null;
  const fin = new Date(inicio.getTime() + (Number(durationMinutes) || 60) * 60_000);

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: name || "Cita",
    dates: `${utcCompacto(inicio)}/${utcCompacto(fin)}`,
    details: description || "",
    location: location || "",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
