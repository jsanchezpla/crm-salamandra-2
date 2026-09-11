/**
 * lib/citas/gastaSesion.js — ¿esta cita ha GASTADO su sesión, o la tiene
 * RESERVADA? La regla del bono, sola (12/09/2026).
 *
 * (Sale de `packs.js` por el mismo motivo por el que salió
 * `bonoDelPaciente.js`: `packs.js` importa el ORM, y la regla la necesita
 * ahora `lib/clinica/diagnostico.js` —PURO a propósito, porque la barra de
 * horas de un diagnóstico se pinta también en el navegador—. Copiarla habría
 * sido tener dos fronteras de 24 h que se separan a la primera. Aquí está una
 * vez y `packs.js` la re-exporta: quien la importaba de allí no nota nada.)
 *
 * ── QUÉ GASTA SESIÓN (regla del contrato que firman) ────────────────────────
 *   · Realizada                                   → gasta
 *   · No se presentó, sin justificar              → gasta
 *   · Cancelada con menos de 24 h de antelación   → gasta
 *   · Cancelada con 24 h o más                    → NO gasta
 *   · No se presentó, justificada                 → NO gasta
 *   · Futura (pendiente o confirmada)             → todavía no la ha gastado,
 *     pero la tiene RESERVADA: no puede pedir otra con ese hueco.
 *
 * Es la misma frontera de 24 h que decidía la devolución del dinero, y por eso
 * se importa la constante de `politicaReembolso.js` en vez de escribir otro 24:
 * si el negocio la cambia, tiene que moverse en los dos sitios a la vez.
 */

import { HORAS_MINIMAS_PARA_REEMBOLSO } from "./politicaReembolso.js";

/**
 * ¿Esta cita ha GASTADO su sesión del bono?
 *
 * `ahora` solo se usa para las canceladas sin `cancelledAt` (citas antiguas):
 * en ese caso se compara la hora de la cita con el presente.
 */
export function gastaSesion(booking, ahora = new Date()) {
  const status = booking?.status;

  if (status === "completed") return true;

  if (status === "no_show") {
    // Tri-estado: null = falta sin clasificar. Se cuenta como gastada, que es
    // lo que dice el contrato; la profesional puede justificarla y deja de
    // contar.
    return booking?.noShowJustified !== true;
  }

  if (status === "cancelled") {
    const cita = new Date(booking?.scheduledAt);
    if (Number.isNaN(cita.getTime())) return false; // sin fecha fiable, no se le cobra la sesión
    const cancelada = booking?.cancelledAt ? new Date(booking.cancelledAt) : ahora;
    const referencia = Number.isNaN(cancelada.getTime()) ? ahora : cancelada;
    const horas = (cita.getTime() - referencia.getTime()) / 3_600_000;
    // Ante la duda (cancelación sin hora registrada), NO gasta: quitarle una
    // sesión a alguien por un dato que nos falta a nosotros no se sostiene.
    return horas < HORAS_MINIMAS_PARA_REEMBOLSO;
  }

  return false; // pending / confirmed: aún no se ha gastado
}

/** ¿Esta cita tiene la sesión RESERVADA (futura, aún sin gastar)? */
export function reservaSesion(booking) {
  return booking?.status === "pending" || booking?.status === "confirmed";
}
