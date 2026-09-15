/**
 * fechaAlCobrar — qué fecha lleva un cobro cuando cambia de estado en el
 * editor (15/09/2026, AV-0148 y AV-0149 de Aumenta: «que saliera la fecha del
 * día por defecto y, si fuera necesario, cambiarla»).
 *
 * «Registrar cobro» ya nacía con hoy desde el 06/09. Lo que obligaba a teclear
 * la fecha era COBRAR UN PENDIENTE: las cuotas del mes se generan como cobros
 * pendientes con la fecha del día 1 (137 de los 162 pendientes de Aumenta,
 * medido el 15/09), y al abrirlos con «Editar» para marcarlos cobrados esa
 * fecha se quedaba puesta. El dinero entra HOY, no el día 1.
 *
 * Regla: al pasar de pendiente a cobrado, la fecha salta a hoy — salvo que
 * alguien ya la hubiera cambiado a mano en el editor, que manda. En cualquier
 * otro cambio de estado la fecha no se toca.
 */

/**
 * @param {object} p
 * @param {string} p.estadoOriginal  estado con el que se abrió el editor
 * @param {string} p.estadoNuevo     estado que se acaba de elegir
 * @param {string} p.fechaOriginal   AAAA-MM-DD con la que se abrió el editor
 * @param {string} p.fechaActual     AAAA-MM-DD que hay ahora en el campo
 * @param {string} p.hoy             AAAA-MM-DD de hoy (en Madrid)
 * @returns {string} la fecha que debe quedar en el campo
 */
export function fechaAlCobrar({ estadoOriginal, estadoNuevo, fechaOriginal, fechaActual, hoy }) {
  if (estadoOriginal !== "pending") return fechaActual;
  if (estadoNuevo === "completed" && (!fechaActual || fechaActual === fechaOriginal)) return hoy;
  // Vuelve a pendiente sin haber tocado la fecha a mano: se devuelve la suya.
  if (estadoNuevo === "pending" && fechaActual === hoy && fechaOriginal) return fechaOriginal;
  return fechaActual;
}
