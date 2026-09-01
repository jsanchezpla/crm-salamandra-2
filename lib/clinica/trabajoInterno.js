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

/**
 * Qué categorías de bloqueo son, sin lugar a dudas, cada clase de hora interna
 * (01/09/2026). Son las claves de fábrica de `lib/citas/categoriasBloqueo.js`.
 *
 * ⚠️ Solo estas dos, y a propósito. Las otras cuatro de fábrica —gestión
 * documental, valoraciones, libre de pacientes y descanso— HOY no cuentan como
 * nada, igual que antes de existir las categorías, y meterlas aquí movería las
 * cifras de Productividad de un centro que lleva meses mirándolas sin que nadie
 * lo haya pedido. Que la gestión documental sea trabajo interno es una decisión
 * de dirección, no del código: cuando la tomen, se añade su clave aquí.
 */
const CATEGORIA_A_CLASE = { trabajo_interno: "ti", reunion_equipo: "equipo" };

/**
 * "ti" | "equipo" | null
 *
 * `categoryKey` es la CATEGORÍA del bloqueo (01/09/2026) y manda sobre el
 * texto: para eso se pidieron las categorías. El texto se queda de respaldo y
 * no como respuesta, porque los 12.030 bloqueos que ya existen no tienen
 * ninguna y se tienen que seguir contando exactamente igual.
 *
 * Un bloqueo CON categoría, pero con una que no es de las de arriba, no cae al
 * texto: si alguien lo marcó como «Descanso», da igual que además haya escrito
 * «reunión equipo» en el motivo. Elegir de la lista es la respuesta buena.
 */
export function clasificarBloqueo(label, categoryKey = null) {
  const cat = typeof categoryKey === "string" ? categoryKey.trim().toLowerCase() : "";
  if (cat) return CATEGORIA_A_CLASE[cat] ?? null;

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
