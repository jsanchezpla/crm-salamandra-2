/**
 * cobrarMes.js — el botón «Cobrar mes» de la ficha de una cita (03/09/2026,
 * Aumenta por Rodrigo).
 *
 * «Debo tener un botón en el modal de las citas, solo visible para quien
 * tenga el módulo de Facturación, que sea COBRAR MES, y en cuanto se cobre a
 * esa persona no vuelva a salir hasta la primera cita del siguiente mes. Ya
 * sea porque se ha cobrado desde la cita —que llevará a Cobros y
 * autorrellenará el Registrar cobro— o porque se ha hecho a mano desde
 * Cobros.» Y el matiz: «lo cobrado no depende de lo facturado».
 *
 * ── LO QUE DECIDE ESTE FICHERO ────────────────────────────────────────────
 *
 *   · De qué MES es una cita: el de su fecha, en hora de Madrid. Una cita del
 *     1 de octubre a las 00:30 es de octubre aunque en UTC aún sea septiembre.
 *   · A dónde lleva el botón: Cobros, con el drawer abierto en modo cuota y
 *     la familia, el paciente y el mes ya puestos. Es el MISMO enlace que el
 *     «Cobrar» del menú contextual de la agenda (31/08/2026), que hasta hoy
 *     solo llevaba la familia.
 *   · Cuándo el mes ya está cobrado, mirando COBROS y solo cobros: un cobro
 *     completado de esa familia con `periodMonth` de ese mes. Ni la factura
 *     ni la cuota asignada cuentan: en Aumenta se cobra primero y se factura
 *     al cierre («Facturar el mes»), así que la factura llega semanas después
 *     del dinero y no puede ser la que apague el botón.
 *
 * ── DE QUIÉN ES EL COBRO QUE APAGA EL BOTÓN ──────────────────────────────
 *
 * Un cobro puede ser de la familia entera (`patientId` a NULL, como nacen
 * los de siempre) o de UN hijo (01/09/2026). Con dos hermanos en cuotas
 * distintas, cobrar la de uno no puede esconder el botón en las citas del
 * otro. Por eso:
 *
 *   · cita CON paciente → la apaga un cobro de ese paciente o uno de toda la
 *     familia;
 *   · cita SIN paciente → la apaga cualquier cobro de la familia ese mes.
 *
 * Todo puro: la ruta `/api/billing/payments/mes` trae los cobros y esto
 * decide; `scripts/_smoke-cobrar-mes.mjs` lo fija sin base de datos.
 */

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** 'AAAA-MM' de una fecha, en hora de Madrid. null si la fecha no vale. */
export function mesDeLaCita(scheduledAt) {
  const d = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit",
  }).format(d).slice(0, 7);
}

/** ¿Es un 'AAAA-MM' bien formado? (lo comparten la ruta y el drawer). */
export function esMes(mes) {
  return typeof mes === "string" && MES_RE.test(mes);
}

/**
 * El enlace a Cobros con el drawer «Registrar cobro» abierto y rellenado.
 * Sin `clientId` no hay a quién cobrar: null.
 */
export function urlCobrarMes({ clientId, patientId = null, mes = null } = {}) {
  if (!clientId) return null;
  const sp = new URLSearchParams({ abrir: "cuota", cliente: String(clientId) });
  if (patientId) sp.set("paciente", String(patientId));
  if (esMes(mes)) sp.set("mes", mes);
  return `/facturacion/cobros?${sp.toString()}`;
}

/**
 * ¿Ya está cobrado el mes para esta cita?
 *
 * `cobros` son los cobros COMPLETADOS de la familia con `periodMonth` del mes
 * (los filtra la ruta); aquí solo se mira de quién es cada uno.
 */
export function mesCobradoPara({ cobros, patientId = null } = {}) {
  const lista = Array.isArray(cobros) ? cobros : [];
  if (!lista.length) return false;
  if (!patientId) return true;
  return lista.some((c) => !c?.patientId || String(c.patientId) === String(patientId));
}

/**
 * El botón entero, o null si no toca enseñarlo.
 *
 *   · sin módulo de Facturación → null (lo pidió así: «solo visible para quien
 *     tenga el módulo»);
 *   · cita sin familia enlazada → null, no hay a quién cobrar;
 *   · `cobros` aún sin respuesta (null/undefined) → null: mejor tardar medio
 *     segundo que enseñar un botón que luego se quita;
 *   · mes ya cobrado → null. Vuelve solo con la primera cita del mes
 *     siguiente, porque ese mes no tiene cobro todavía.
 *
 * Devuelve { href, mes, rotulo, titulo }.
 */
export function botonCobrarMes({ booking, conFacturacion = false, cobros = null } = {}) {
  if (!conFacturacion || !booking?.clientId) return null;
  if (!Array.isArray(cobros)) return null;
  const mes = mesDeLaCita(booking.scheduledAt);
  if (!mes) return null;
  if (mesCobradoPara({ cobros, patientId: booking.patientId ?? null })) return null;
  const href = urlCobrarMes({ clientId: booking.clientId, patientId: booking.patientId ?? null, mes });
  return {
    href,
    mes,
    rotulo: "Cobrar mes",
    titulo: `Abre Cobros con el cobro de ${rotuloDeMes(mes)} de esta familia ya rellenado`,
  };
}

/** «septiembre de 2026», para el título del botón. */
export function rotuloDeMes(mes) {
  if (!esMes(mes)) return mes ?? "";
  const [a, m] = mes.split("-").map(Number);
  return new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(a, m - 1, 1)));
}
