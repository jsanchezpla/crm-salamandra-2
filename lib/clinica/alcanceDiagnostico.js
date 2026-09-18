/**
 * lib/clinica/alcanceDiagnostico.js — quién puede BORRAR un expediente de
 * diagnóstico, y cuándo (18/09/2026, AV-0202 de Aumenta; decidido por Rodrigo).
 *
 * (Fichero nuevo en /lib, regla #2: es un «si tiene X no puede Y» con nombre y
 * con prueba, como `puedeBorrarInforme` en `alcanceInformes.js` y
 * `puedeBorrarIncidencia` en `alcanceIncidencias.js`. Lo necesitan el endpoint
 * y, el día que se quiera pintar el botón solo a quien puede, la pantalla.)
 *
 * ── DE QUÉ PREGUNTA NACE ────────────────────────────────────────────────────
 * Isabel: «¿y cómo borro o elimino si lo hago mal? ¿O hago pruebas como con
 * Aumentín?». La API tenía cerrar, parar, seguir y unir, y ningún borrado: un
 * expediente abierto por error se quedaba para siempre —solo se podía «parar»,
 * que además significa otra cosa: que la familia decidió no continuar—.
 *
 * ── LA REGLA ────────────────────────────────────────────────────────────────
 * Se borra lo que todavía no ha pasado a otra parte. En cuanto el expediente ha
 * salido de sí mismo, ya no es un borrador: es el rastro de algo que ocurrió.
 *
 *   · Con BONO creado (`packId`), no. Al «Seguir» nace un bono sin tope, y ese
 *     bono lleva sesiones que se descuentan de las citas.
 *   · Con COBRO de la entrevista (`entrevistaPaymentId`), no. Ahí hay dinero
 *     apuntado, y el dinero no se borra por la puerta de atrás: se anula el
 *     cobro en Facturación, que deja su rastro.
 *   · Con INFORME unido (`informeId`), no. Un informe de valoración es un
 *     documento que alguien ha leído.
 *   · Lo borra DIRECCIÓN (quien decide bonos) o SU terapeuta. No cualquiera:
 *     un expediente lleva el motivo de consulta de un menor.
 *
 * Lo que NO se borra nunca es lo clínico: los registros de sesión atados al
 * expediente se SUELTAN (`diagnostico_id` a NULL) y siguen en la historia del
 * paciente. Borrar un expediente no puede llevarse por delante lo que una
 * profesional escribió de una sesión que sí ocurrió.
 */

/**
 * ¿Se puede borrar este expediente? Pura.
 *
 * @param {{ puedeDecidir: boolean, fila: { packId?, entrevistaPaymentId?, informeId?, therapistId? }|null, teamMemberId: string|null }} args
 */
export function puedeBorrarDiagnostico({ puedeDecidir, fila, teamMemberId }) {
  return motivoParaNoBorrarDiagnostico({ puedeDecidir, fila, teamMemberId }) === null;
}

/**
 * El motivo, en las palabras que ve quien lo intenta. `null` = puede.
 *
 * El orden importa: primero lo que impide borrarlo A CUALQUIERA —el bono, el
 * cobro, el informe— y después quién es quien pregunta. Así a la terapeuta que
 * intenta borrar uno con bono se le dice lo que pasa de verdad, y no «no tienes
 * permiso», que la mandaría a buscar a dirección para nada.
 */
export function motivoParaNoBorrarDiagnostico({ puedeDecidir, fila, teamMemberId }) {
  if (!fila) return "Ese diagnóstico no existe";
  if (fila.packId) {
    return "Este diagnóstico ya tiene un bono de sesiones: ciérralo en vez de borrarlo";
  }
  if (fila.entrevistaPaymentId) {
    return "Este diagnóstico ya tiene un cobro apuntado: anula antes el cobro en Facturación";
  }
  if (fila.informeId) {
    return "Este diagnóstico ya está unido a un informe: sepáralo antes de borrarlo";
  }
  if (puedeDecidir) return null;
  if (!teamMemberId) return "Solo dirección, o la terapeuta del diagnóstico, puede borrarlo";
  return String(fila.therapistId ?? "") === String(teamMemberId)
    ? null
    : "Solo dirección, o la terapeuta del diagnóstico, puede borrarlo";
}
