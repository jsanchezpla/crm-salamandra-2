/**
 * coloresBloqueo.js — de qué color se pinta un bloqueo en la agenda.
 *
 * Hasta el 10/08/2026 el color estaba escrito a fuego en `CitasModule.jsx`
 * (`#0F0F0F`, negro con letra blanca desde el 07/08). Rodrigo pidió poder
 * cambiarlo, y además que cada profesional pueda tener el suyo: en un centro
 * con varias personas, unas vacaciones del mismo color que las de la compañera
 * no dicen de quién son sin acercar el ratón al tramo.
 *
 * ── Por qué NO se reusa `avatarColor` ──────────────────────────────────────
 *
 * Cada miembro del equipo ya tiene un color (el de su avatar) que además pinta
 * SUS CITAS en la agenda. Si los bloqueos heredaran ese mismo color, el hueco
 * ocupado y el hueco libre-pero-vetado se verían igual, que es justo lo que hay
 * que distinguir de un vistazo. Por eso `TeamMember.blockColor` es un campo
 * aparte, y vacío por defecto.
 *
 * ── Quién gana ─────────────────────────────────────────────────────────────
 *
 * El de la persona, si lo tiene; si no, el general del centro; si tampoco, el
 * negro de siempre. Un bloqueo del CENTRO (sin `teamMemberId`, un cierre con
 * hora) no tiene persona de la que heredar y usa siempre el general.
 */

/**
 * El negro que llevaba escrito a fuego el calendario. Se queda de suelo, así
 * que quien no toque nada sigue viendo exactamente lo de antes.
 */
export const COLOR_BLOQUEO_POR_DEFECTO = "#0F0F0F";

/**
 * Deja el color como se guarda: en mayúsculas y sin espacios, o `null` si viene
 * vacío. Vaciarlo es la forma de decir «vuelve a heredar el de arriba», así que
 * el hueco es un valor con significado, no un campo a medio rellenar.
 *
 * NO valida: para eso está `isValidHexColor` de `./validation.js`, que ya
 * existía. Se aplica sobre el resultado de esta función.
 */
export function limpiaColorBloqueo(valor) {
  if (typeof valor !== "string") return null;
  const v = valor.trim();
  return v ? v.toUpperCase() : null;
}

/**
 * El color con el que se pinta un tramo bloqueado.
 *
 * @param colorPersona  `blockColor` del miembro dueño del bloqueo (o null)
 * @param colorGeneral  el del centro, de `settings.citas.colorBloqueos` (o null)
 */
export function colorDeBloqueo(colorPersona, colorGeneral) {
  return colorPersona || colorGeneral || COLOR_BLOQUEO_POR_DEFECTO;
}

/**
 * Blanco o negro para la letra, según lo oscuro que sea el fondo.
 *
 * El bloqueo se pinta como un bloque con su etiqueta y el nombre encima, y esa
 * letra era blanca fija cuando el fondo era siempre negro. Ahora el fondo lo
 * elige el cliente: sobre un amarillo o un rosa claro, el blanco no se lee.
 *
 * Umbral 0.6 sobre la luminancia relativa (ITU-R BT.601, la ponderación que
 * usan los navegadores para escala de grises): por encima el fondo es claro y
 * pide letra oscura.
 */
export function colorTextoSobre(fondo) {
  const hex = typeof fondo === "string" ? fondo.trim().replace("#", "") : "";
  if (hex.length !== 6) return "#FFFFFF";
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  if ([r, g, b].some(Number.isNaN)) return "#FFFFFF";
  const luminancia = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminancia > 0.6 ? "#111111" : "#FFFFFF";
}
