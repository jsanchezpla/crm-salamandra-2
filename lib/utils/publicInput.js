/**
 * lib/utils/publicInput.js — saneo de entrada de endpoints públicos.
 *
 * (Regla #2) creado en la revisión de bugs 2026-07-23: los endpoints públicos
 * de leads y referidos volcaban `customFields` (JSONB) tal cual, sin tope de
 * tamaño ni de longitud por valor. Un anónimo podía guardar un objeto enorme o
 * profundamente anidado → contaminación de datos y abuso de almacenamiento.
 */

const MAX_JSON_BYTES = 8 * 1024; // 8 KB de customFields por registro
const MAX_VALOR = 2000; // longitud máxima de un valor de texto

/**
 * Devuelve un objeto plano seguro: recorta cada valor de texto y descarta el
 * conjunto si, serializado, supera el tope de bytes (devuelve {} en ese caso).
 * No es un validador de esquema — solo un cortafuegos de tamaño.
 */
export function sanearCustomFields(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof k !== "string" || k.length > 64) continue;
    if (typeof v === "string") out[k] = v.slice(0, MAX_VALOR);
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (v == null) out[k] = null;
    // objetos/arrays anidados se descartan: un JSONB público no debe anidar.
  }
  try {
    if (Buffer.byteLength(JSON.stringify(out), "utf8") > MAX_JSON_BYTES) return {};
  } catch {
    return {};
  }
  return out;
}
