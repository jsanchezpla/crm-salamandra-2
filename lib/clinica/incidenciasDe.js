/**
 * lib/clinica/incidenciasDe.js — el `where` de «las incidencias de ESTA
 * persona» (31/08/2026), en un solo sitio.
 *
 * El multi-responsable vive en la tabla pivote (incidencia_assignees), pero
 * tres consultas seguían mirando solo `assignedToId` —el responsable
 * PRINCIPAL—: la campana, Equipo → Bandeja y el bloque Mi trabajo de la
 * portada. Resultado: el 2.º y 3.er responsables no se enteraban de nada,
 * mientras el listado de incidencias ya consultaba bien la pivote. Con la
 * regla aquí, el próximo lector no puede volver a elegir mal.
 *
 * Sin la pivote (un tenant sin migrar) se cae al principal, que es lo que
 * había: mejor un aviso de menos que una consulta rota.
 *
 * ── «LAS MÍAS» Y «LAS QUE TENGO PENDIENTES» (04/09/2026) ────────────────────
 * Con el botón de «Visto» (`lib/clinica/vistoIncidencia.js`) dejan de ser lo
 * mismo, y la diferencia importa:
 *
 *   · `soloPendientes: false` (por defecto) → LAS MÍAS. Es la pregunta de
 *     quién puede VERLA, y la contesta `alcanceIncidencias.js`. Dar una por
 *     vista no puede hacerla invisible: entonces no habría forma de recuperar
 *     una despachada por error.
 *   · `soloPendientes: true` → LAS QUE ME QUEDAN. Es la pregunta de las tres
 *     bandejas —la campana, Equipo → Bandeja y Mi trabajo de la portada—, y de
 *     eso va el visto: apartarlas de ahí.
 *
 * El parámetro y no dos funciones porque la lectura de la pivote es la misma y
 * porque así el próximo lector tiene que ELEGIR, en vez de coger la que haya.
 */
import { Op } from "sequelize";

export async function whereIncidenciasDe(models, teamMemberId, { soloPendientes = false } = {}) {
  if (models?.IncidenciaAssignee) {
    const where = { teamMemberId };
    if (soloPendientes) where.vistoAt = null;
    const enlaces = await models.IncidenciaAssignee.findAll({
      where,
      attributes: ["incidenciaId"],
      raw: true,
    });
    return { id: { [Op.in]: enlaces.map((e) => e.incidenciaId) } };
  }
  return { assignedToId: teamMemberId };
}

/**
 * Las incidencias que ESTA persona ya ha dado por vistas. La usa el listado
 * para apartarlas sin sacarlas de su alcance (`?vistas=1` las devuelve).
 * Lista de ids, no un `where`: entra como `notIn` o como `in` según quién
 * pregunte.
 */
export async function idsVistasPor(models, teamMemberId) {
  if (!teamMemberId || !models?.IncidenciaAssignee) return [];
  const filas = await models.IncidenciaAssignee.findAll({
    where: { teamMemberId, vistoAt: { [Op.ne]: null } },
    attributes: ["incidenciaId"],
    raw: true,
  });
  return filas.map((f) => f.incidenciaId);
}
