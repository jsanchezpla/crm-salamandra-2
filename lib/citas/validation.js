/**
 * Validaciones y helpers compartidos del módulo Citas.
 */

export const VALID_MODALITIES = ["presencial", "phone", "online"];
export const VALID_STATUS = ["confirmed", "completed", "cancelled", "no_show"];

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeString(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

export function normalizeEmail(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed.toLowerCase();
}

export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Nombre de un tipo de cita → su slug (la URL pública), o «» si no hay nada
 * que rescatar.
 *
 * El corte a 64 va ANTES de quitar el guion final, no después (20/08/2026).
 * Al revés, un nombre de más de 63 letras seguido de otra palabra
 * (`"a".repeat(63) + " b"`) daba un slug de 64 que TERMINABA en guion, y ese
 * slug no pasa `isValidSlug`: `POST /api/citas/event-types` solo valida el
 * slug cuando lo teclea una persona, así que el generado se guardaba sin
 * mirar, la URL pública quedaba con el guion colgando y quien luego editara
 * el tipo a mano se comía un «slug inválido» que no venía de nada que
 * hubiera tocado. El guion de cabeza se quita antes del corte porque es basura
 * del nombre, no del recorte, y así no gasta uno de los 64.
 */
export function slugify(name) {
  if (name == null) return "";
  return String(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 64)
    .replace(/-+$/, "");
}

export function isValidSlug(value) {
  return typeof value === "string" && SLUG_RE.test(value);
}

export function isValidHexColor(value) {
  if (value == null) return true;
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

export function normalizeModalities(value) {
  if (!Array.isArray(value)) return null;
  const cleaned = [];
  const seen = new Set();
  for (const m of value) {
    if (typeof m !== "string") return null;
    const lower = m.trim().toLowerCase();
    if (!VALID_MODALITIES.includes(lower)) return null;
    if (seen.has(lower)) continue;
    seen.add(lower);
    cleaned.push(lower);
  }
  if (cleaned.length === 0) return null;
  return cleaned;
}

/**
 * Valida que los campos por modalidad estén presentes según `modalities`.
 * Devuelve un string con el mensaje de error o null si todo OK.
 */
export function validateModalityFields({ modalities, location, phoneNumber, meetUrl }) {
  if (modalities.includes("presencial") && !location) {
    return "El campo 'location' es obligatorio cuando se acepta modalidad presencial";
  }
  if (modalities.includes("phone") && !phoneNumber) {
    return "El campo 'phoneNumber' es obligatorio cuando se acepta modalidad telefónica";
  }
  // `meetUrl` NO es obligatorio, a diferencia de la dirección y el teléfono.
  //
  // Exigirlo contradecía el propio módulo: el modo por defecto —y el
  // recomendado— es el MANUAL, en el que la profesional crea la videollamada
  // cuando toca y pega el enlace en esa cita concreta. Pedirle por adelantado
  // una sala permanente que la mayoría no tiene solo conseguía que escribiera
  // cualquier cosa para poder guardar: así aparecieron en nutri_laura dos
  // enlaces de mentira (`meet.google.com/nutri-laura-primera`) que habrían
  // llegado a pacientes reales el día que alguien cambiara el modo a
  // automático. Un campo obligatorio que el sistema después ignora no protege
  // de nada; fabrica datos falsos.
  //
  // La dirección y el teléfono sí siguen siendo obligatorios porque ahí no hay
  // segundo momento: si la cita es presencial, el paciente necesita saber
  // adónde ir desde que reserva.
  return null;
}

/**
 * Convierte HH:MM o HH:MM:SS a minutos desde medianoche.
 */
export function timeToMinutes(value) {
  if (!value) return null;
  const parts = String(value).split(":");
  if (parts.length < 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/**
 * Acepta HH:MM o HH:MM:SS y devuelve HH:MM:SS, o `null` si no es una hora.
 *
 * Solo devuelve horas que `timeToMinutes` entienda (19/08/2026). Antes no miraba
 * el rango y «24:00» salía como «24:00:00»: los tres endpoints de disponibilidad
 * lo daban por bueno, `timeToMinutes` devolvía `null` para compararlo y la
 * guarda «endTime debe ser mayor que startTime» dejaba pasar un tramo
 * 24:00→10:00, que se guardaba tal cual. Lo sacó `_smoke-citas-validation.mjs`.
 * Las dos funciones tienen que decir lo mismo de la misma cadena.
 */
export function normalizeTime(value) {
  const minutos = timeToMinutes(value);
  if (minutos === null) return null;
  const h = String(Math.floor(minutos / 60)).padStart(2, "0");
  const m = String(minutos % 60).padStart(2, "0");
  return `${h}:${m}:00`;
}
