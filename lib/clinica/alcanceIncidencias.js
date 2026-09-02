/**
 * lib/clinica/alcanceIncidencias.js — quién puede ver (y borrar) cada incidencia.
 *
 * Lo pidió Aumenta el 02/09/2026 (AV-0018 y AV-0013): «las incidencias de las
 * terapeutas de tipo laboral no deberían poder ser vistas por todo el equipo.
 * Cada terapeuta que vea las suyas. Pero Dirección que pueda ver todas», y
 * «solo deja marcar como resuelta, pero no eliminar en el caso de crear una
 * incidencia por error».
 *
 * La regla, escrita UNA vez para que el listado, la ficha, los adjuntos y el
 * borrado no puedan decir cosas distintas:
 *
 *   · Dirección (`admin` / `superadmin`) ve TODAS.
 *   · Cualquier otra persona ve las que REGISTRÓ ella o en las que es
 *     RESPONSABLE (por la tabla pivote, y por el espejo `assignedToId` para las
 *     anteriores al multi-responsable).
 *   · Quien no tiene ficha de equipo y no es dirección no ve ninguna: antes se
 *     le enseñaba todo «para no dejarle una lista vacía», y eso es justo lo que
 *     hay que evitar ahora.
 *   · Borrar: dirección cualquiera; el resto SOLO las que registró.
 *
 * `whereIncidenciasVisibles` reutiliza `whereIncidenciasDe` (la de la bandeja),
 * que ya sabe leer la pivote y caer al espejo en un tenant sin migrar.
 */

import { Op } from "sequelize";

import { whereIncidenciasDe } from "./incidenciasDe.js";
import { resolveCurrentTeamMemberId } from "../team/currentTeamMember.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/** Dirección ve todo. */
export function veTodasLasIncidencias(ctx) {
  return ADMIN_ROLES.has(ctx?.user?.role);
}

/**
 * La condición SQL de «las mías» para quien NO es dirección. Sin ficha de
 * equipo devuelve una condición que no casa con ninguna fila.
 */
export async function whereIncidenciasVisibles(models, teamMemberId) {
  if (!teamMemberId) return { id: { [Op.in]: [] } };
  const asignadas = await whereIncidenciasDe(models, teamMemberId);
  return { [Op.or]: [asignadas, { reportedById: teamMemberId }] };
}

/** La misma regla sobre UNA fila ya cargada (ficha, adjuntos, edición). */
export async function puedeVerIncidencia(models, row, teamMemberId) {
  if (!row || !teamMemberId) return false;
  if (row.reportedById === teamMemberId) return true;
  if (row.assignedToId === teamMemberId) return true;
  if (models?.IncidenciaAssignee) {
    const n = await models.IncidenciaAssignee.count({ where: { incidenciaId: row.id, teamMemberId } });
    return n > 0;
  }
  return false;
}

/**
 * La comprobación tal cual la hacen los endpoints de UNA incidencia (ficha,
 * edición, adjuntos): `true` = esta persona no tiene que verla. Una ajena se
 * contesta con 404 y no con 403: decir «existe pero no es tuya» ya cuenta algo.
 */
export async function incidenciaFueraDeAlcance(request, ctx, row) {
  if (veTodasLasIncidencias(ctx)) return false;
  const yoSoy = await resolveCurrentTeamMemberId(request, ctx.tenantModels);
  return !(await puedeVerIncidencia(ctx.tenantModels, row, yoSoy));
}

/** Dirección borra cualquiera; el resto, solo la que registró. Pura. */
export function puedeBorrarIncidencia({ esAdmin, row, teamMemberId }) {
  if (esAdmin) return true;
  if (!row || !teamMemberId) return false;
  return row.reportedById === teamMemberId;
}
