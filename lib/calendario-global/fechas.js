/**
 * lib/calendario-global/fechas.js — qué fecha acepta el calendario global
 * (12/09/2026, tras la revisión del calendario global v2).
 *
 * (Fichero nuevo en /lib, regla #2: `fechaValida` vivía dentro de
 * `proyectos.js` y la revisión encontró que `eventos.js` y el GET de
 * /api/calendario-global/eventos se conformaban con la regex. `2026-02-31` o
 * `2026-13-01` la pasan y llegaban a Postgres: un 500 al mover un evento y,
 * en el GET, TODOS los clientes marcados «no responde» por una fecha mal
 * escrita. Una sola función para las tres puertas, para que no vuelvan a
 * decir cosas distintas.)
 *
 * PURA y sin importar nada: la carga la prueba ligera
 * `_smoke-calendario-global.mjs` con Node suelto.
 */

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * ¿Es una fecha civil de verdad, en `YYYY-MM-DD`? El formato no basta:
 * `2026-02-31` pasa la regex y Postgres lo rechazaría con un 500. Se comprueba
 * con aritmética UTC, sin `toISOString()` (que en Madrid puede cambiar el día).
 */
export function fechaValida(valor) {
  if (typeof valor !== "string" || !FECHA.test(valor)) return false;
  const [a, m, d] = valor.split("-").map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

/**
 * La fecha de un parámetro de la URL (`start`, `end`), o null si no vale.
 *
 * Acepta `YYYY-MM-DD` y, si llega un ISO con hora (`2026-09-07T00:00:00+02:00`,
 * lo que manda FullCalendar si nadie lo recorta), se queda con la parte de la
 * fecha, que es lo mismo que ya hace la pantalla con `startStr.split("T")[0]`.
 * La hora no se convierte de zona a propósito: el día que se ve en la pantalla
 * es el que va antes de la «T».
 */
export function fechaDeParametro(valor) {
  if (typeof valor !== "string") return null;
  const parte = valor.trim().split("T")[0];
  return fechaValida(parte) ? parte : null;
}
