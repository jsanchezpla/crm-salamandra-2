/**
 * lib/clinica/plantillaDeLaCita.js — con qué PLANTILLA nace el registro de
 * sesión que se prepara desde una cita (12/09/2026).
 *
 * (Fichero nuevo en /lib, regla #2: hasta hoy la regla era un ternario dentro
 * del modal de la cita —«si el tipo es la valoración inicial, la plantilla de
 * la entrevista»— y con los diagnósticos deja de caber en un ternario: la
 * entrevista inicial de un diagnóstico es una cita de tipo DIAGNÓSTICO, no de
 * tipo ENTREVISTA INICIAL, y AUN ASÍ se escribe con la plantilla de la
 * entrevista. Un `if` con dos ramas y sin nombre, en un JSX de 1.400 líneas,
 * es justo lo que la regla 16 pide que viva en `lib/` con su prueba.)
 *
 * ── LA REGLA, EN ORDEN ─────────────────────────────────────────────────────
 *   1. La cita es el tramo `entrevista` de un diagnóstico → `entrevista_inicial`
 *      (aunque su tipo sea DIAGNÓSTICO: lo que se escribe ES una entrevista).
 *   2. Su tipo de cita es la valoración inicial del centro
 *      (`EventType.isInitialAssessment`) → `entrevista_inicial`, como desde el
 *      02/09/2026 (AV-0017 de Aumenta).
 *   3. Lo demás → `null`: la pantalla de preparar usa la primera plantilla del
 *      centro, como siempre.
 *
 * Devuelve la CLAVE (`PLANTILLA_ENTREVISTA.key`) o `null`, que es lo que
 * `colaDePreparacion` de `prepararSesion.js` espera en `plantilla`.
 */

import { PLANTILLA_ENTREVISTA } from "./plantillas.js";
import { TRAMO_ENTREVISTA } from "../citas/altaDesdeDiagnostico.js";

/** La clave de plantilla con la que se prepara el registro de esta cita, o null. */
export function plantillaDeLaCita(booking) {
  const b = booking?.toJSON ? booking.toJSON() : booking;
  if (!b || typeof b !== "object") return null;
  if (b.diagnosticoId && b.diagnosticoTramo === TRAMO_ENTREVISTA) return PLANTILLA_ENTREVISTA.key;
  if (b.eventType?.isInitialAssessment === true) return PLANTILLA_ENTREVISTA.key;
  return null;
}
