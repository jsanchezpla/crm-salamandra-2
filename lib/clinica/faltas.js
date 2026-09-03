/**
 * lib/clinica/faltas.js — la FALTA dentro de una incidencia (03/09/2026,
 * Rodrigo por AV-0038 de Aumenta: «la pestaña Faltas dentro de Incidencias y
 * que automáticamente se envíe a Faltas»).
 *
 * ── QUÉ ES ─────────────────────────────────────────────────────────────────
 * Al marcar una falta en la agenda se abre sola una incidencia
 * (lib/citas/incidenciaPorFalta.js). Hasta hoy era una incidencia más entre
 * las demás; Olga pedía verlas aparte y llevar su ciclo: qué huecos se le
 * ofrecieron a la familia, si aceptó o rechazó, y cuándo se recuperó. Eso es
 * `incidencias.falta` (JSONB): con la columna a NULL la incidencia es de las
 * de siempre; con ella, es una falta y vive en la pestaña «Faltas».
 *
 *   { justificada, bookingId, huecosOfrecidos, respuesta, fechaRecuperacion, nota }
 *
 * `respuesta`: `pendiente` (sin contestar), `aceptada` (recupera; con
 * `fechaRecuperacion`), `rechazada` (no recupera). Aceptada o rechazada
 * CIERRAN la incidencia (status resolved, verificación resuelta): «rechazada
 * la fecha indicada o aceptada, y se elimine esa falta pendiente».
 *
 * Todo aquí es puro y se prueba en `scripts/_smoke-faltas.mjs`.
 */

export const RESPUESTAS_FALTA = Object.freeze({
  pendiente: { label: "Sin respuesta", level: "amber" },
  aceptada: { label: "Acepta, recupera", level: "green" },
  rechazada: { label: "No recupera", level: "gray" },
});

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXTO = 2000;

/** La falta con la que NACE la incidencia automática: sin respuesta aún. */
export function faltaDesdeBooking(booking) {
  return {
    justificada: booking?.noShowJustified === true,
    bookingId: booking?.id && UUID.test(booking.id) ? booking.id : null,
    huecosOfrecidos: "",
    respuesta: "pendiente",
    fechaRecuperacion: null,
    nota: "",
  };
}

/**
 * Lo que la pantalla manda en `falta` al editar, validado y fundido con lo
 * que ya había. Devuelve `{ ok, falta }` o `{ ok:false, error }`. Solo se
 * tocan los campos que vienen; `justificada` y `bookingId` no se editan
 * desde aquí (los puso la agenda).
 */
export function fundirFalta(actual, cambios) {
  if (!actual || typeof actual !== "object") return { ok: false, error: "Esta incidencia no es una falta" };
  if (!cambios || typeof cambios !== "object") return { ok: false, error: "Falta inválida" };
  const out = { ...actual };
  if ("huecosOfrecidos" in cambios) out.huecosOfrecidos = String(cambios.huecosOfrecidos ?? "").trim().slice(0, MAX_TEXTO);
  if ("nota" in cambios) out.nota = String(cambios.nota ?? "").trim().slice(0, MAX_TEXTO);
  if ("respuesta" in cambios) {
    const r = String(cambios.respuesta ?? "pendiente");
    if (!RESPUESTAS_FALTA[r]) return { ok: false, error: "Respuesta inválida" };
    out.respuesta = r;
  }
  if ("fechaRecuperacion" in cambios) {
    const f = cambios.fechaRecuperacion;
    if (f != null && f !== "" && !FECHA.test(String(f))) return { ok: false, error: "Fecha de recuperación inválida" };
    out.fechaRecuperacion = f ? String(f) : null;
  }
  if (out.respuesta === "aceptada" && !out.fechaRecuperacion) {
    return { ok: false, error: "Si la familia acepta, apunta la fecha de la cita de recuperación" };
  }
  return { ok: true, falta: out };
}

/**
 * Qué estado le toca a la incidencia según la respuesta: contestada (acepta o
 * rechaza) = cerrada; sin respuesta = como estaba. Devuelve null si no hay
 * que tocar el estado.
 */
export function cierrePorRespuesta(falta) {
  if (!falta) return null;
  if (falta.respuesta === "aceptada" || falta.respuesta === "rechazada") {
    return { status: "resolved", verification: "resuelta" };
  }
  return null;
}

/** El texto corto para el listado: «Justificada · Acepta, recupera el 12/09». */
export function resumenFalta(falta) {
  if (!falta) return "";
  const tipo = falta.justificada ? "Justificada" : "Sin justificar";
  const r = RESPUESTAS_FALTA[falta.respuesta]?.label ?? RESPUESTAS_FALTA.pendiente.label;
  const fecha = falta.respuesta === "aceptada" && falta.fechaRecuperacion ? ` el ${fechaCorta(falta.fechaRecuperacion)}` : "";
  return `${tipo} · ${r}${fecha}`;
}

function fechaCorta(iso) {
  const m = FECHA.exec(String(iso ?? ""));
  return m ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : String(iso ?? "");
}

/**
 * La falta que se deduce de una incidencia automática ANTERIOR a esta columna
 * (backfill de la migración): por el título que escribió `textoIncidenciaFalta`.
 * Devuelve null si no parece una falta.
 */
export function faltaDesdeTitulo(titulo) {
  const t = String(titulo ?? "");
  if (!/^Falta (justificada|injustificada) · /.test(t)) return null;
  return {
    justificada: t.startsWith("Falta justificada"),
    bookingId: null,
    huecosOfrecidos: "",
    // Sin respuesta apuntada: lo que se sepa de ellas lo escribe el centro.
    // Si ya estaban resueltas, su estado se respeta (la respuesta no lo toca).
    respuesta: "pendiente",
    fechaRecuperacion: null,
    nota: "",
  };
}
