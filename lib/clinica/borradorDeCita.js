/**
 * lib/clinica/borradorDeCita.js — qué pasa con el registro PREPARADO de una
 * cita cuando la cita no se da (02/09/2026, AV-0026 de Aumenta).
 *
 * (Fichero nuevo en /lib, regla #2: la regla la necesitan tres sitios que no
 * se conocen —el PATCH de la cita, el listado de sesiones y la ficha del
 * paciente— y escrita en cada uno se separaría a la primera.)
 *
 * ── DE QUÉ QUEJA NACE ──────────────────────────────────────────────────────
 * Una terapeuta prepara la sesión desde la cita («Preparar sesión» crea un
 * borrador con `booking_id`, con el día y la hora de la cita), el paciente no
 * viene y marca la falta injustificada. La cita queda en `no_show` y abre su
 * incidencia, como toca… pero el borrador seguía vivo: en la ficha del
 * paciente salía como una sesión de hoy por completar, y en la cita seguía el
 * botón «Marcar completada» al lado del rótulo de la falta. Preparar es el
 * flujo normal (11 borradores de citas de ese mismo día en Aumenta), así que
 * pasaba cada vez que faltaba alguien con la sesión preparada.
 *
 * ── LA REGLA ───────────────────────────────────────────────────────────────
 * Al pasar la cita a falta (o a cancelada), sus borradores EN BLANCO se
 * retiran: no dicen nada y solo confunden. Un borrador con algo escrito —una
 * preparación, un adjunto, cualquier apartado, una nota— SE CONSERVA: es
 * trabajo de alguien y la sesión puede recuperarse otro día. Lo que se
 * conserva deja de disfrazarse de sesión: el listado dice cómo acabó su cita
 * (`bookingStatus`) y la ficha lo rotula «Preparada · el paciente no vino».
 *
 * No hay un estado nuevo en `clinic_sessions` a propósito: «no dada» sería un
 * cuarto estado que tendrían que aprender las estadísticas, los informes, el
 * PDF y las 22.045 sesiones de Aumenta, para distinguir una cosa que la cita ya
 * sabe decir sola.
 */

import { CLAVE_APARTADOS, CLAVE_PLANTILLA } from "./plantillas.js";

/** Cómo acabó una cita que NO se dio, en las palabras de la ficha. */
export const CITA_SIN_DAR = Object.freeze({
  no_show: "el paciente no vino",
  cancelled: "cita cancelada",
});

/** ¿Es una cita que no se dio? (falta, justificada o no, o cancelada) */
export function citaNoSeDio(cita) {
  const status = typeof cita === "string" ? cita : cita?.status;
  return Object.prototype.hasOwnProperty.call(CITA_SIN_DAR, status);
}

const texto = (v) => (v == null ? "" : String(v).trim());

/** ¿Hay algo escrito dentro de esto? Baja por listas y objetos. */
function hayAlgo(v) {
  if (v == null) return false;
  if (typeof v === "string") return texto(v).length > 0;
  if (typeof v === "number" || typeof v === "boolean") return true;
  if (Array.isArray(v)) return v.some(hayAlgo);
  if (typeof v === "object") return Object.values(v).some(hayAlgo);
  return false;
}

/**
 * ¿Es un borrador EN BLANCO? Solo entonces se puede retirar sin perder nada.
 *
 * Mira todo lo que una persona puede escribir en un registro: preparación y
 * adjuntos, el cuerpo de siempre (objetivos, actividades, desempeño, las
 * observaciones), los apartados nuevos, la devolución de la familia, las notas
 * internas y lo que haya dejado la IA. La foto de la plantilla dentro de
 * `contentSections` (`apartados`, `plantilla`) NO es contenido: la lleva todo
 * borrador recién creado.
 *
 * Ante la duda, `false`: un borrador que no se retira se ve; uno que se
 * retira con texto dentro, no.
 */
export function borradorVacio(sesion) {
  if (!sesion || typeof sesion !== "object") return false;
  const s = typeof sesion.toJSON === "function" ? sesion.toJSON() : sesion;
  if (s.status !== "draft") return false;
  if (hayAlgo(s.prepText) || hayAlgo(s.prepFiles)) return false;
  if (hayAlgo(s.objectives) || hayAlgo(s.activities) || hayAlgo(s.performance)) return false;
  if (hayAlgo(s.observations)) return false;
  if (hayAlgo(s.parentFeedback) || hayAlgo(s.internalNotes)) return false;
  if (hayAlgo(s.aiTranscription) || hayAlgo(s.aiStructured)) return false;
  const cs = s.contentSections && typeof s.contentSections === "object" && !Array.isArray(s.contentSections) ? s.contentSections : {};
  for (const [clave, valor] of Object.entries(cs)) {
    if (clave === CLAVE_APARTADOS || clave === CLAVE_PLANTILLA) continue;
    if (hayAlgo(valor)) return false;
  }
  return true;
}

/**
 * El rótulo que sustituye a «Borrador» cuando la cita del registro no se dio.
 * `null` en cualquier otro caso: la pantalla pinta entonces su etiqueta de
 * siempre. Lee `bookingStatus`, que `GET /api/clinica/sessions` añade a cada
 * registro que sale de una cita.
 */
export function rotuloDeBorrador(sesion) {
  if (!sesion || sesion.status !== "draft") return null;
  const motivo = CITA_SIN_DAR[sesion.bookingStatus];
  return motivo ? `Preparada · ${motivo}` : null;
}

/**
 * Retira los borradores en blanco de una cita que acaba de pasar a falta o a
 * cancelada. Devuelve cuántos se borraron y cuántos se conservaron por tener
 * algo escrito. Sin modelo (tenant sin clínica) o sin cita, no hace nada.
 */
export async function retirarBorradoresDeLaCita({ ClinicSession, bookingId }) {
  const resultado = { borrados: 0, conservados: 0 };
  if (!ClinicSession || !bookingId) return resultado;
  const borradores = await ClinicSession.findAll({ where: { bookingId, status: "draft" } });
  for (const b of borradores) {
    if (borradorVacio(b)) {
      await b.destroy();
      resultado.borrados++;
    } else {
      resultado.conservados++;
    }
  }
  return resultado;
}

/**
 * De qué cita sale cada registro y cómo acabó: `Map(bookingId → status)`.
 * Una consulta para toda la lista, y solo de las citas que hagan falta. Sin
 * modelo de citas (tenant sin `citas`) devuelve el mapa vacío y el listado
 * sale como siempre.
 */
export async function estadoDeLasCitas({ Booking, sesiones }) {
  const mapa = new Map();
  const ids = [...new Set((Array.isArray(sesiones) ? sesiones : []).map((s) => s?.bookingId).filter(Boolean))];
  if (!Booking || ids.length === 0) return mapa;
  const citas = await Booking.findAll({ where: { id: ids }, attributes: ["id", "status"] });
  for (const c of citas) mapa.set(c.id, c.status);
  return mapa;
}
