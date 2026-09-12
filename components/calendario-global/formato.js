/**
 * Fechas, etiquetas y colores de la interfaz del calendario global
 * (12/09/2026).
 *
 * Fichero puro, sin React ni `window`: lo usan la pestaña Calendario, la de
 * Proyectos y el tablero, y así las tres dicen «Pendiente», «En pausa» o
 * «lun 14 sept» igual.
 *
 * ── FECHAS SIN HORA ─────────────────────────────────────────────────────────
 * Las fechas límite de tarjetas e hitos son DATEONLY (`YYYY-MM-DD`). Nunca se
 * pasan por `new Date("YYYY-MM-DD")` a pelo —eso es medianoche UTC y en Madrid
 * puede caer el día anterior— ni por `toISOString()`. Para pintarlas se ancla a
 * mediodía local; para comparar, se comparan CADENAS con `hoyMadrid()`, como
 * hace `lib/projects/faseProgreso.js`.
 */

export { hoyMadrid } from "../../lib/projects/faseProgreso.js";

export const FECHA = /^\d{4}-\d{2}-\d{2}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `"2026-09-14T10:30:00+02:00"` → `{ date: "2026-09-14", time: "10:30" }`. */
export function parteFecha(iso) {
  if (!iso) return { date: "", time: "" };
  const [date, rest] = String(iso).split("T");
  return { date, time: rest ? rest.slice(0, 5) : "" };
}

/** `"2026-09-14"` → «lun 14 sept». Cadena vacía si no es una fecha. */
export function diaCorto(fecha, { conSemana = true, conAnio = false } = {}) {
  if (!FECHA.test(String(fecha ?? ""))) return "";
  const d = new Date(`${fecha}T12:00:00`);
  return d.toLocaleDateString("es-ES", {
    ...(conSemana ? { weekday: "short" } : {}),
    day: "numeric",
    month: "short",
    ...(conAnio ? { year: "numeric" } : {}),
  });
}

/**
 * Cuándo es un evento de FullCalendar, en una línea. Un todo-el-día trae el
 * fin EXCLUSIVO (el día siguiente), por eso se resta uno.
 */
export function fechaDeEvento(ev) {
  const start = parteFecha(ev?.startStr);
  const end = parteFecha(ev?.endStr);
  const dia = diaCorto(start.date);
  if (!dia) return "";
  if (ev.allDay) {
    if (end.date && end.date !== start.date) {
      const d2 = new Date(`${end.date}T12:00:00`);
      d2.setDate(d2.getDate() - 1);
      const dia2 = d2.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
      if (dia2 !== dia) return `${dia} → ${dia2} · todo el día`;
    }
    return `${dia} · todo el día`;
  }
  const horas = start.time ? (end.time ? `${start.time}–${end.time}` : start.time) : "";
  return horas ? `${dia} · ${horas}` : dia;
}

/**
 * El título de un evento sin lo que el servidor le añade para el calendario:
 * `fetchProjectEvents` pinta «Tarea · COD» y los hitos con una bandera
 * delante. En la rejilla sirve; en la ficha, donde el proyecto va en su
 * propia fila, sobra.
 */
export function tituloDeEvento(ev) {
  const ep = ev?.extendedProps ?? {};
  let t = String(ev?.title ?? "");
  if (ep.kind === "projectMilestone") t = t.replace(/^\u{1F6A9}\s*/u, "");
  if (ep.kind === "projectTask" || ep.kind === "projectMilestone") {
    const cola = ep.projectCode || ep.projectName;
    if (cola && t.endsWith(` · ${cola}`)) t = t.slice(0, -(cola.length + 3));
  }
  return t.trim() || "(sin título)";
}

/** «COD · Nombre», o solo lo que haya. */
export function nombreDeProyecto({ projectCode, projectName, code, name } = {}) {
  const c = projectCode ?? code;
  const n = projectName ?? name;
  return [c, n].filter(Boolean).join(" · ");
}

/**
 * Prioridad. Los colores de alta/media/baja son los de
 * `lib/calendar/calendarEvent.js`; `urgent` solo existe en Proyectos.
 */
export const PRIORIDAD = {
  urgent: { etiqueta: "Urgente", color: "#991B1B" },
  high: { etiqueta: "Alta", color: "#ef4444" },
  medium: { etiqueta: "Media", color: "#f97316" },
  low: { etiqueta: "Baja", color: "#22c55e" },
};

export function prioridad(valor) {
  return PRIORIDAD[valor] ?? PRIORIDAD.medium;
}

/** Estado de un evento del calendario (`CalendarTask.status`). */
export const ESTADO_EVENTO = {
  pending: { etiqueta: "Pendiente", tono: "ambar" },
  done: { etiqueta: "Hecha", tono: "verde" },
  cancelled: { etiqueta: "Cancelada", tono: "apagado" },
};

/** Estado de un proyecto (`Project.status`). */
export const ESTADO_PROYECTO = {
  draft: { etiqueta: "Borrador", tono: "neutral" },
  active: { etiqueta: "Activo", tono: "verde" },
  paused: { etiqueta: "En pausa", tono: "ambar" },
  completed: { etiqueta: "Completado", tono: "neutral" },
  cancelled: { etiqueta: "Cancelado", tono: "apagado" },
};

/** Estado de un hito (`Milestone.status`). */
export const ESTADO_HITO = {
  pending: { etiqueta: "Pendiente", tono: "ambar" },
  completed: { etiqueta: "Completado", tono: "verde" },
  missed: { etiqueta: "No cumplido", tono: "rojo" },
};

/**
 * Lo que se avisa antes de «Abrir en el CRM», según con quién se entra
 * (`ficha.saltoComo`). Un solo sitio para el texto: el 12/09/2026 la revisión
 * encontró cuatro frases distintas (el botón, la cabecera de la lista, el
 * tablero, la ficha) y todas prometían «15 minutos» que no se cumplían.
 *
 *   - `"admin"`: la sesión como admin del cliente dura DE VERDAD hasta 15
 *     minutos y no se renueva (SessionKeeper ya no la corta a los 12). Y el
 *     pase se canjea en el host del CRM: su cookie va por navegador, no por
 *     pestaña, así que PISA la sesión del CRM que se tenga abierta (las
 *     pestañas del CRM propio pasarían a escribir en el cliente). Se dice
 *     antes de pulsar.
 *   - `"cuenta"`: la cuenta vinculada, con su sesión normal; pisa igual la
 *     sesión abierta en este navegador.
 *   - sin `saltoComo`: `null` (lo dice quien pinta: «Sin cuenta…»).
 *
 * `corta`: para sitios estrechos (la cabecera de un cliente en la lista);
 * quien la use debe dejar la larga en el `title`.
 */
export function notaDelSalto(ficha, { corta = false } = {}) {
  if (ficha?.saltoComo === "admin") {
    const quien = ficha.saltoEmail || "su administrador";
    return corta
      ? `Entrarás como ${quien} · 15 min`
      : `Entrarás como ${quien}. La sesión no se renueva: dura 15 minutos y cierra la del CRM que tengas abierta en este navegador.`;
  }
  if (ficha?.saltoComo === "cuenta") {
    const quien = ficha.saltoEmail || "la cuenta vinculada";
    return corta
      ? `Entrarás con ${quien}`
      : `Entrarás con ${quien}. Cierra la sesión del CRM que tengas abierta en este navegador.`;
  }
  return null;
}

/** Busca sin mayúsculas ni tildes: «aumenta» encuentra «Aúmenta». */
export function normalizar(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}
