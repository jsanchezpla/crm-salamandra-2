/**
 * SLA del módulo Soporte: objetivos de PRIMERA RESPUESTA y RESOLUCIÓN por
 * prioridad, en horas. Configurables por tenant en `support_settings.sla_config`
 * (lo que falte cae a estos defaults).
 *
 * Simplificación asumida en v1 (documentada en docs/modules/support.md): el
 * reloj de resolución NO se pausa mientras el ticket está "waiting" (esperando
 * al cliente). Pausar exigiría acumular intervalos por cambio de estado; si un
 * tenant lo pide, se hará entonces.
 */

export const SLA_PRIORITIES = ["critical", "high", "medium", "low"];

// Congelado hasta el fondo: `Object.freeze` no baja a las prioridades, y estas
// horas son el plazo de TODOS los tenants que no tienen ajustes propios. Una
// escritura despistada en cualquiera de los sitios que las leen las cambiaría
// para todos, en caliente y sin dejar rastro en ninguna tabla.
export const DEFAULT_SLA = Object.freeze({
  critical: Object.freeze({ firstResponseHours: 2, resolutionHours: 8 }),
  high: Object.freeze({ firstResponseHours: 4, resolutionHours: 24 }),
  medium: Object.freeze({ firstResponseHours: 8, resolutionHours: 72 }),
  low: Object.freeze({ firstResponseHours: 24, resolutionHours: 120 }),
});

const ACTIVE_STATUSES = new Set(["open", "in_progress", "waiting"]);

function positiveHours(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 24 * 90 ? n : fallback;
}

/** Config efectiva: defaults + overrides válidos del tenant. */
export function effectiveSla(settings) {
  const cfg = settings?.slaConfig && typeof settings.slaConfig === "object" ? settings.slaConfig : {};
  const out = {};
  for (const p of SLA_PRIORITIES) {
    const base = DEFAULT_SLA[p];
    const o = cfg[p] && typeof cfg[p] === "object" ? cfg[p] : {};
    out[p] = {
      firstResponseHours: positiveHours(o.firstResponseHours, base.firstResponseHours),
      resolutionHours: positiveHours(o.resolutionHours, base.resolutionHours),
    };
  }
  return out;
}

/**
 * Fechas objetivo para un ticket nuevo (o al cambiar de prioridad un ticket
 * cuyo hito aún no se cumplió). `null`s si el tenant tiene el SLA apagado.
 */
export function computeDueDates(priority, settings, from = new Date()) {
  if (settings && settings.slaEnabled === false) {
    return { firstResponseDueAt: null, resolutionDueAt: null };
  }
  const sla = effectiveSla(settings)[SLA_PRIORITIES.includes(priority) ? priority : "medium"];
  const desde = from instanceof Date ? from.getTime() : new Date(from ?? Date.now()).getTime();
  // Un `from` que no se puede leer cuenta desde ahora, y nunca deja el ticket
  // sin objetivo: aquí `null` quiere decir una sola cosa —este tenant no tiene
  // SLA—, y un ticket que sí lo tiene no puede quedarse sin plazo en silencio,
  // porque lo que no vence no sale ni en la bandeja ni en la campana. Guardar
  // dos Invalid Date sería peor todavía: la columna se queda en NULL igual,
  // pero sin que nadie lo haya decidido.
  const base = Number.isFinite(desde) ? desde : Date.now();
  return {
    firstResponseDueAt: new Date(base + sla.firstResponseHours * 3600_000),
    resolutionDueAt: new Date(base + sla.resolutionHours * 3600_000),
  };
}

function milestone({ dueAt, doneAt, ticketActive, now }) {
  const due = dueAt ? new Date(dueAt).getTime() : null;
  const done = doneAt ? new Date(doneAt).getTime() : null;
  if (!due) return { dueAt: null, doneAt: doneAt ?? null, state: "none" };
  if (done != null) {
    return { dueAt, doneAt, state: done <= due ? "met" : "missed" };
  }
  if (!ticketActive) {
    // Cerrado sin cumplir el hito (p. ej. cerrado sin resolver): no cuenta.
    return { dueAt, doneAt: null, state: "none" };
  }
  return { dueAt, doneAt: null, state: now > due ? "breached" : "pending" };
}

/**
 * Estado SLA calculado de un ticket (para pintar chips y para las alertas):
 *   pending  → en plazo, aún sin cumplir
 *   breached → plazo vencido y sin cumplir (lo urgente de la bandeja)
 *   met      → cumplido a tiempo
 *   missed   → cumplido fuera de plazo
 *   none     → sin objetivo (SLA apagado al crearse, o hito ya no aplicable)
 */
export function slaState(ticket, now = Date.now()) {
  const active = ACTIVE_STATUSES.has(ticket.status);
  const resolvedAt = ticket.resolvedAt || ticket.closedAt || null;
  return {
    firstResponse: milestone({
      dueAt: ticket.firstResponseDueAt,
      doneAt: ticket.firstResponseAt,
      ticketActive: active,
      now,
    }),
    resolution: milestone({
      dueAt: ticket.resolutionDueAt,
      doneAt: resolvedAt,
      ticketActive: active,
      now,
    }),
  };
}

/** ¿Tiene el ticket algún hito vencido y sin cumplir? (para campana/bandeja) */
export function isSlaBreached(ticket, now = Date.now()) {
  const s = slaState(ticket, now);
  return s.firstResponse.state === "breached" || s.resolution.state === "breached";
}
