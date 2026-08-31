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
 */
import { Op } from "sequelize";

export async function whereIncidenciasDe(models, teamMemberId) {
  if (models?.IncidenciaAssignee) {
    const enlaces = await models.IncidenciaAssignee.findAll({
      where: { teamMemberId },
      attributes: ["incidenciaId"],
      raw: true,
    });
    return { id: { [Op.in]: enlaces.map((e) => e.incidenciaId) } };
  }
  return { assignedToId: teamMemberId };
}
