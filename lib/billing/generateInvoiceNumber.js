import { Op } from "sequelize";

/**
 * Genera el siguiente número de factura para el año actual.
 * Formato: F-{YYYY}-{NNNN}  →  F-2026-0001
 */
export async function generateInvoiceNumber(Invoice) {
  const year = new Date().getFullYear();
  const prefix = `F-${year}-`;

  const count = await Invoice.count({
    where: { number: { [Op.like]: `${prefix}%` } },
  });

  return `${prefix}${String(count + 1).padStart(4, "0")}`;
}
