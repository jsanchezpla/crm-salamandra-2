/**
 * lib/clients/estadoPorActividad.js — Activo, En pausa o Baja según lo que
 * ha pasado con esa persona, curso a curso (15/09/2026, Rodrigo, Aumenta).
 *
 * (Fichero nuevo en /lib, regla #2: la regla la usan el script que pone el
 * estado a todo el centro y la reactivación automática, y tiene su prueba en
 * `scripts/_smoke-estado-por-actividad.mjs`.)
 *
 * ── LA PETICIÓN ─────────────────────────────────────────────────────────────
 * Morosidad enseñaba 690 familias «sin cuota» que debían dinero, y casi todas
 * eran gente que llevaba tiempo sin venir. Rodrigo: nada se borra; cada
 * paciente y cada familia tiene uno de tres estados:
 *
 *   · Activo   — sale en la agenda desde septiembre (el curso en marcha).
 *   · En pausa — tuvo terapia el curso pasado (septiembre a agosto) y en este
 *                todavía no.
 *   · Baja     — antes del curso pasado puede haber sesiones, cobros o
 *                facturas, pero desde entonces no hay nada.
 *
 * Para ser Activo cuenta la AGENDA: una cita no cancelada o una sesión clínica
 * desde septiembre (una cita futura también), o una cuota vigente. Los cobros y
 * las facturas no: la factura de agosto se emite en septiembre, y marcaría
 * activo a quien ya no viene. Para separar En pausa de Baja cuenta TODO —cita,
 * sesión, cobro completado o factura emitida—, que es lo que se pidió: «antes
 * puede haber sesiones, cobros o facturas, pero después no hay nada».
 *
 * Lo que sí reactiva solo es entrar en una cuota o pagar un cobro NUEVO
 * (`reactivarPorActividad.js`): eso ya no es la cola de un mes pasado.
 *
 * Los cursos empiezan el 1 de septiembre, igual que las cuotas de Aumenta.
 */

export const ACTIVO = "active";
export const PAUSA = "paused";

/** 'AAAA-MM-DD' del 1 de septiembre del curso en marcha en `hoy`. */
export function inicioDelCurso(hoy = new Date()) {
  const d = hoy instanceof Date ? hoy : new Date(hoy);
  const anio = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
  return `${anio}-09-01`;
}

/** 'AAAA-MM-DD' del 1 de septiembre del curso anterior. */
export function inicioDelCursoAnterior(hoy = new Date()) {
  const inicio = inicioDelCurso(hoy);
  return `${Number(inicio.slice(0, 4)) - 1}-09-01`;
}

const dia = (v) => (v == null ? null : String(v instanceof Date ? v.toISOString() : v).slice(0, 10));

/**
 * El estado que le toca.
 *
 * @param {object} a
 * @param {string|Date|null} a.ultimaCita       la más reciente (o futura) de cita no cancelada o sesión
 * @param {string|Date|null} a.ultimoDinero     el cobro completado o la factura emitida más reciente
 * @param {boolean} [a.cuotaVigente]            tiene una cuota activa sin fecha de fin pasada
 * @param {string} baja                         el valor de «Baja» en esa tabla ('inactive' en
 *                                              clientes, 'discharged' en pacientes)
 */
export function estadoPorActividad({ ultimaCita = null, ultimoDinero = null, cuotaVigente = false }, { baja, hoy = new Date() }) {
  if (cuotaVigente) return ACTIVO;
  const cita = dia(ultimaCita);
  if (cita && cita >= inicioDelCurso(hoy)) return ACTIVO;
  const ultima = [cita, dia(ultimoDinero)].filter(Boolean).sort().pop();
  if (ultima && ultima >= inicioDelCursoAnterior(hoy)) return PAUSA;
  return baja;
}

/**
 * Los estados de los que se VUELVE a activo solo, al entrar en una cuota o al
 * recibir un cobro. «No vino» (prospect) no está: esa ficha nunca empezó y la
 * cambia quien la lleva.
 */
export const ESTADOS_QUE_SE_REACTIVAN = {
  clients: ["paused", "inactive"],
  patients: ["paused", "discharged"],
};

/** De los estados de una familia y los de su propio dinero, el más vivo. */
export function elMasVivo(estados, baja) {
  if (estados.includes(ACTIVO)) return ACTIVO;
  if (estados.includes(PAUSA)) return PAUSA;
  return baja;
}
