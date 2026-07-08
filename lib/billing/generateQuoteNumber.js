/**
 * Asigna número de presupuesto (serie "P", P-YYYY-NNNN).
 *
 * A diferencia de las facturas, el presupuesto NO es fiscal: se numera al
 * CREAR y se permiten huecos. Se calcula el siguiente número consultando el
 * MAX existente para el prefijo+año. La unicidad la garantiza el índice
 * `quotes_number_key`; el endpoint reintenta si dos altas colisionan.
 */
import { Op } from "sequelize";

export async function assignQuoteNumber({ models, seriesCode = "P", date = null, t = null } = {}) {
  const { Quote } = models;
  const year = date ? new Date(date).getFullYear() : new Date().getFullYear();
  const pattern = `${seriesCode}-${year}-%`;

  const existing = await Quote.findOne({
    where: { number: { [Op.like]: pattern } },
    order: [["number", "DESC"]],
    attributes: ["number"],
    ...(t ? { transaction: t } : {}),
  });

  let next = 1;
  if (existing) {
    const m = existing.number.match(/-(\d+)$/);
    next = m ? Number(m[1]) + 1 : 1;
  }

  return `${seriesCode}-${year}-${String(next).padStart(4, "0")}`;
}
