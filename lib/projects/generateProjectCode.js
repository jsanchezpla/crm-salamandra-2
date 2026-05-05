/**
 * Generador del código secuencial de Project: "PRY-{YYYY}-{NNNN}".
 *
 * Para Sprint 1 usamos un cálculo simple con `MAX(code)` filtrado por año.
 * No hay tabla de contador (a diferencia de InvoiceSeries de billing) porque:
 *   - El código del proyecto NO es fiscal (no requiere correlatividad
 *     garantizada sin huecos).
 *   - Concurrencia esperada baja (muy pocas creaciones por minuto).
 *
 * Si en el futuro hace falta más rigor, migrar a un contador con
 * SELECT … FOR UPDATE.
 */

import { Op } from "sequelize";

export async function generateProjectCode({ tenantModels, year = new Date().getFullYear() }) {
  const { Project } = tenantModels;
  const prefix = `PRY-${year}-`;

  const last = await Project.findOne({
    where: { code: { [Op.like]: `${prefix}%` } },
    order: [["code", "DESC"]],
    attributes: ["code"],
    paranoid: false,
  });

  let next = 1;
  if (last?.code) {
    const tail = last.code.slice(prefix.length);
    const parsed = parseInt(tail, 10);
    if (!Number.isNaN(parsed)) next = parsed + 1;
  }

  return `${prefix}${String(next).padStart(4, "0")}`;
}
