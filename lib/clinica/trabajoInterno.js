/**
 * lib/clinica/trabajoInterno.js — qué cuenta como trabajo INTERNO en
 * Productividad (31/08/2026, Rodrigo).
 *
 * Tres reglas pequeñas y con nombre:
 *
 *  · `clasificarBloqueo`: los bloqueos de agenda «Reservado T.I.» y «REUNIÓN
 *    EQUIPO» son las horas internas que el centro YA apunta — pero la
 *    etiqueta es texto libre y en producción vive escrita de tres formas
 *    («Reservado T.I.», «Reservado T.I», «Reservado t.i.»). Se normaliza
 *    (minúsculas, sin tildes, sin puntos) o el sumatorio se parte en tres.
 *
 *  · `valoracionEsInterna`: una valoración inicial a un paciente NO asignado
 *    a esa terapeuta es captación/estudio, no atención a su paciente — cuenta
 *    como interna. Al asignado, directa.
 *
 *  · `desgloseDeCita`: bono (lleva packId), taller (el tipo de cita se llama
 *    taller/grupal — no hay flag mejor: los 57 tipos importados de Organízate
 *    solo se distinguen por nombre) o normal.
 */

function normalizar(texto) {
  return String(texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "ti" | "equipo" | null */
export function clasificarBloqueo(label) {
  const s = normalizar(label);
  if (!s) return null;
  // «Reservado T.I.» en sus tres grafías queda como "reservado t i".
  if (/\bt ?i\b/.test(s) && s.includes("reservado")) return "ti";
  if (s.includes("equipo") && (s.includes("reunion") || s.includes("trabajo"))) return "equipo";
  return null;
}

/** ¿Esta valoración cuenta como interna? (paciente sin asignar a la terapeuta) */
export function valoracionEsInterna({ teamMemberId, terapeutasDelPaciente }) {
  if (!teamMemberId) return true;
  return !(Array.isArray(terapeutasDelPaciente) && terapeutasDelPaciente.includes(teamMemberId));
}

/** "bono" | "taller" | "normal" */
export function desgloseDeCita({ packId, eventTypeName }) {
  if (packId) return "bono";
  const s = normalizar(eventTypeName);
  if (/\btaller\b|\bgrupal\b/.test(s)) return "taller";
  return "normal";
}

/** Minutos de un tramo [startAt, endAt) que caen dentro de [desde, hasta). */
export function minutosDentroDe(startAt, endAt, desde, hasta) {
  const a = Math.max(new Date(startAt).getTime(), desde.getTime());
  const b = Math.min(new Date(endAt).getTime(), hasta.getTime());
  return b > a ? Math.round((b - a) / 60000) : 0;
}
