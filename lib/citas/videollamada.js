/**
 * lib/citas/videollamada.js — cómo consigue su enlace una cita online.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten el alta de cita del panel y
 * la reserva pública, que hasta ahora decidían esto por su cuenta.)
 *
 * DOS MODOS, por tenant (Configuración → Citas):
 *
 *   "manual" (POR DEFECTO) — la cita nace SIN enlace. La profesional crea la
 *     videollamada donde quiera (Meet, Zoom, Teams…), pega el enlace en la
 *     ficha de la cita y pulsa «Guardar y enviar», que se lo manda al paciente
 *     por email. Es el comportamiento que pidió el usuario: nadie promete un
 *     enlace que luego no funciona.
 *
 *   "automatico" — para el tenant que TIENE contratada su sala de
 *     videollamadas (Google Workspace/Meet, Zoom Pro…) y ha puesto el enlace
 *     fijo de sala en el tipo de cita: la cita lo hereda sola al crearse y el
 *     paciente lo recibe ya en el email de confirmación, sin pasos manuales.
 *
 * OJO, honestidad de producto: el modo "automatico" NO genera salas nuevas
 * llamando a Google — para eso hace falta la integración con Google Calendar,
 * que todavía no existe. Reutiliza el enlace de sala fija del tipo de cita,
 * que es lo que de verdad tiene un cliente con Meet contratado.
 */

export const MODOS_VIDEOLLAMADA = ["manual", "automatico"];

/** Modo del tenant. Cualquier valor raro cae al seguro: manual. */
export function modoVideollamada(tenant) {
  return tenant?.settings?.citas?.meetModo === "automatico" ? "automatico" : "manual";
}

/**
 * Enlace con el que nace una cita online.
 * @param {object} tenant  fila de master.tenants (con settings)
 * @param {object} eventType  tipo de cita (con su meetUrl de sala fija)
 * @param {string} modality  "online" | "presencial" | "phone"
 */
export function meetUrlInicial(tenant, eventType, modality) {
  if (modality !== "online") return null;
  if (modoVideollamada(tenant) !== "automatico") return null;
  const url = eventType?.meetUrl;
  return url && String(url).trim() ? String(url).trim() : null;
}
