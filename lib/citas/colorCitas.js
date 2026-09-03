/**
 * lib/citas/colorCitas.js — un color para TODAS las citas de la agenda
 * (03/09/2026, Aumenta por Rodrigo).
 *
 * (Fichero nuevo en /lib, regla #2: lo leen el endpoint del calendario, que
 * pinta, y el de Configuración, que guarda y devuelve; la regla de qué color
 * gana no puede estar escrita dos veces.)
 *
 * ── EL ENCARGO ──────────────────────────────────────────────────────────────
 * «El mismo color para las citas de todas las terapeutas: 9BBDC7 con letra
 * negra.» Hasta hoy cada cita se pintaba del color de su profesional (el
 * `avatarColor` de la ficha de equipo) o, sin profesional, del color del tipo
 * de cita. Con dieciocho personas en la agenda compartida eso son dieciocho
 * colores, y Aumenta prefiere uno.
 *
 * ── POR QUÉ UN AJUSTE Y NO EL COMPORTAMIENTO DE TODOS ───────────────────────
 * El color por persona es justo lo que usa un centro pequeño para ver de un
 * vistazo de quién es cada cita; quitárselo a todo el mundo por lo que pide
 * uno sería el caso 2 de la escalera resuelto mal. Es un ajuste del centro
 * (`settings.citas.colorCitas`, Configuración → Agenda): puesto, manda sobre
 * el color de la persona y el del tipo; vacío, todo sigue como siempre. Los
 * estados apagados (cancelada, falta, atendida) conservan sus grises: siguen
 * teniendo que distinguirse de una cita viva.
 *
 * La LETRA no se guarda: la calcula la agenda contra el fondo
 * (`colorTextoSobre`, lib/citas/coloresBloqueo.js). Sobre #9BBDC7 sale negra,
 * que es lo que se pidió; sobre un color oscuro saldría blanca.
 */

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * El color único del centro, o `null` si pinta por persona (lo de siempre).
 * Acepta el tenant entero o cualquier objeto con `settings`.
 */
export function colorCitasDe(tenant) {
  const v = tenant?.settings?.citas?.colorCitas;
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return HEX_RE.test(s) ? s : null;
}

/**
 * El color con el que se pinta UNA cita viva: el único del centro si lo hay,
 * si no el de la persona, si no el del tipo, y si no el verde de siempre.
 */
export function colorDeCita({ unico = null, persona = null, tipo = null, defecto = "#3F6E5B" } = {}) {
  return unico || persona || tipo || defecto;
}
