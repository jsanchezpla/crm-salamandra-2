/**
 * lib/clinica/alcanceCoordinaciones.js — quién puede CORREGIR un acta de
 * coordinación (18/09/2026, AV-0102 de Aumenta).
 *
 * (Fichero nuevo en /lib, regla #2: es un «esta persona sí / esta no» con
 * nombre y con prueba —`scripts/_smoke-coordinaciones-alcance.mjs`—, como
 * `puedeBorrarInforme` en alcanceInformes.js. La necesitan el endpoint y la
 * pantalla, que pinta el botón solo a quien puede.)
 *
 * ── DE QUÉ QUEJA NACE ──────────────────────────────────────────────────────
 * «Cuando registras una coordinación no tienes opción a modificarla» (Silvia,
 * 18/09/2026). El endpoint `/api/clinica/coordinations` tenía GET y POST y
 * ningún PATCH: una fecha mal puesta, un acuerdo a medio escribir o el paciente
 * equivocado se quedaban así para siempre, y la única salida era registrar el
 * acta otra vez y dejar la mala al lado.
 *
 * ── LA REGLA ───────────────────────────────────────────────────────────────
 *   · La corrige **quien la registró** (su ficha de equipo) o **dirección**.
 *   · Un acta sin ficha de equipo detrás —las 171 traídas de Organízate que
 *     firma gente que ya no está— solo la toca dirección: no hay nadie a quien
 *     reconocerle la autoría, y el resto del equipo no estuvo en esa reunión.
 *
 * Es la misma frontera que en los informes y por el mismo motivo: un acta la
 * escribe alguien, y reescribir lo que otra persona contó de una reunión a la
 * que no fuiste es peor que no poder tocarlo. Dirección siempre puede, que es
 * quien responde del expediente.
 *
 * A diferencia de los informes, aquí NO hay estado que mire: un acta no se
 * entrega a una familia ni pasa por revisión, así que no existe el «ya la ha
 * leído alguien, no se toca». Si eso cambia, la condición va aquí y no en el
 * endpoint.
 */

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/** ¿Es dirección? Mismo criterio que el resto del módulo clínico. */
export function esDireccion(role) {
  return ADMIN_ROLES.has(role);
}

/**
 * ¿Puede esta persona corregir esta acta? Pura.
 *
 * @param {{ esAdmin: boolean, row: { createdById?: string|null }|null, teamMemberId: string|null }} args
 */
export function puedeEditarCoordinacion({ esAdmin, row, teamMemberId }) {
  if (!row) return false;
  if (esAdmin) return true;
  if (!teamMemberId || !row.createdById) return false;
  return String(row.createdById) === String(teamMemberId);
}

/** El motivo, en las palabras que ve quien lo intenta. `null` = puede. */
export function motivoParaNoEditar({ esAdmin, row, teamMemberId }) {
  if (!row) return "Esa coordinación no existe";
  if (puedeEditarCoordinacion({ esAdmin, row, teamMemberId })) return null;
  if (!row.createdById) {
    return "Esta acta no está firmada por nadie del equipo: solo dirección puede corregirla";
  }
  return "Solo dirección, o quien registró la coordinación, puede corregirla";
}
