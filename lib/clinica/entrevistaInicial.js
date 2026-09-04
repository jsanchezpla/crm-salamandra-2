/**
 * lib/clinica/entrevistaInicial.js — la entrevista inicial se ESCRIBE como un
 * registro de sesión y se ARCHIVA con los informes.
 *
 * (Fichero nuevo en /lib, regla #2: la misma pregunta —«¿esto es una entrevista
 * inicial?»— se la hacen tres sitios que no se conocen: el PDF, que la nombra
 * en su portada; la ficha del paciente, que decide en qué pestaña va; y el
 * cajón desde el que se abre. Con una copia en cada uno, la primera que
 * alguien tocara dejaría a las otras dos diciendo otra cosa.)
 *
 * ── DE QUÉ QUEJA NACE (AV-0042 de Aumenta, 04/09/2026) ─────────────────────
 * «Al generar las entrevistas iniciales se guardan en la ficha del paciente
 * como sesiones en lugar de como informe. ¿Podríamos cambiar el lugar donde se
 * guarda?»
 *
 * El 03/09/2026 la entrevista inicial dejó de ser un TIPO DE INFORME y pasó a
 * escribirse como registro de sesión, con sus 15 apartados y la IA del audio o
 * del bloc de notas (Rodrigo: «tienen que tener la estructura de los registros
 * de sesión»). Eso es CÓMO SE ESCRIBE, y no cambia. Lo que faltaba es DÓNDE SE
 * GUARDA: quedaba en la pestaña «Sesiones», mezclada con las sesiones
 * semanales —hasta 241 en un paciente de Aumenta—, cuando es el documento al
 * que se vuelve: el primero del paciente, el que se imprime y el que se enseña.
 * Va con los informes.
 *
 * Las dos cosas no se contradicen. Por dentro sigue siendo una fila de
 * `clinic_sessions` (su plantilla, su PDF, su IA, su cita, sus estadísticas y
 * el recuento de sesiones del paciente); por fuera se archiva donde la busca
 * quien la escribió.
 *
 * ── CÓMO SE RECONOCE ───────────────────────────────────────────────────────
 * Por la PLANTILLA con la que se escribió: `contentSections.plantilla ===
 * 'entrevista_inicial'`, la clave de `PLANTILLA_ENTREVISTA` —y también la que
 * usa un centro que guarde la suya con ese nombre, así que vale para los dos—.
 * No por el tipo de cita (un registro se puede escribir sin cita) ni por el
 * título (lo pone el documento al imprimirse, no está guardado).
 */

import { CLAVE_PLANTILLA, PLANTILLA_ENTREVISTA } from "./plantillas.js";

/** La clave de plantilla que marca una entrevista inicial. */
export const CLAVE_ENTREVISTA = PLANTILLA_ENTREVISTA.key;

/** ¿Este registro de sesión es una entrevista inicial? */
export function esEntrevistaInicial(sesion) {
  const s = sesion?.toJSON ? sesion.toJSON() : sesion;
  const cs =
    s?.contentSections && typeof s.contentSections === "object" && !Array.isArray(s.contentSections)
      ? s.contentSections
      : {};
  const clave = cs[CLAVE_PLANTILLA];
  return typeof clave === "string" && clave.trim() === CLAVE_ENTREVISTA;
}

/** El instante de un registro, o 0 si no tiene fecha legible (nunca NaN). */
function cuando(r) {
  const t = new Date(r?.sessionDate ?? 0).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Reparte los registros de un paciente en los DOS sitios de su ficha:
 * `sesiones` (la pestaña Sesiones) y `entrevistas` (que van con los informes).
 *
 * Admite varias listas porque la ficha pide dos: las últimas sesiones —100 por
 * defecto, que es el tope del endpoint— y, aparte, las entrevistas del
 * paciente. Si no fueran dos, los 50 pacientes de Aumenta que pasan de 100
 * sesiones perderían de vista la suya justo en cuanto deja de ser reciente, que
 * es cuando hace falta ir a buscarla: es el registro más ANTIGUO de todos.
 *
 * Se deduplica por id (una entrevista reciente llega por las dos listas) y se
 * ordena por fecha de sesión, de la más nueva a la más vieja, que es como
 * llegan las dos.
 */
export function repartirRegistros(...listas) {
  const vistos = new Map();
  for (const lista of listas) {
    for (const r of Array.isArray(lista) ? lista : []) {
      if (!r || r.id == null || vistos.has(r.id)) continue;
      vistos.set(r.id, r);
    }
  }
  const todos = [...vistos.values()].sort((a, b) => cuando(b) - cuando(a));
  return {
    sesiones: todos.filter((r) => !esEntrevistaInicial(r)),
    entrevistas: todos.filter((r) => esEntrevistaInicial(r)),
  };
}
