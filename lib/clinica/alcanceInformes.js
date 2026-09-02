/**
 * lib/clinica/alcanceInformes.js — quién puede BORRAR un informe clínico
 * (02/09/2026, AV-0021 de Aumenta; regla elegida por Rodrigo el mismo día).
 *
 * (Fichero nuevo en /lib, regla #2: es un «si tiene X no puede Y» con nombre y
 * con prueba, como `puedeBorrarIncidencia` en alcanceIncidencias.js. La
 * necesitan el endpoint y, el día que se quiera pintar el botón solo a quien
 * puede, la pantalla.)
 *
 * ── DE QUÉ QUEJA NACE ──────────────────────────────────────────────────────
 * «Eliminar un informe de prueba que aparece como vencido; solo me deja
 * editarlo.» El endpoint del informe tenía GET y PATCH y ningún DELETE, así
 * que un informe abierto por error se quedaba para siempre —y encima contaba
 * como vencido en la portada de todo el centro—.
 *
 * ── LA REGLA ───────────────────────────────────────────────────────────────
 *   · Solo un BORRADOR. Un informe revisado o entregado a una familia ya es un
 *     documento que alguien ha leído: no se borra nunca, ni dirección.
 *   · Lo borra quien lo firma (su terapeuta) o dirección (admin). El informe
 *     no guarda quién pulsó «Nuevo informe»: su autor, a todos los efectos, es
 *     la terapeuta que lo firma.
 */

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/** ¿Es dirección? Mismo criterio que el resto del módulo clínico. */
export function esDireccion(role) {
  return ADMIN_ROLES.has(role);
}

/**
 * ¿Puede esta persona borrar este informe? Pura.
 *
 * @param {{ esAdmin: boolean, row: { status?: string, therapistId?: string|null }|null, teamMemberId: string|null }} args
 */
export function puedeBorrarInforme({ esAdmin, row, teamMemberId }) {
  if (!row || row.status !== "draft") return false;
  if (esAdmin) return true;
  if (!teamMemberId) return false;
  return String(row.therapistId ?? "") === String(teamMemberId);
}

/** El motivo, en las palabras que ve quien lo intenta. `null` = puede. */
export function motivoParaNoBorrar({ esAdmin, row, teamMemberId }) {
  if (!row) return "Ese informe no existe";
  if (row.status !== "draft") return "Un informe revisado o entregado no se borra: solo se puede editar";
  if (puedeBorrarInforme({ esAdmin, row, teamMemberId })) return null;
  return "Solo dirección, o la terapeuta que lo firma, puede borrar un informe en borrador";
}
