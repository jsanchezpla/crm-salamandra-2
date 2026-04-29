/**
 * Asigna número de factura usando InvoiceSeries.
 *
 * Reglas:
 *   - El número se asigna SOLO en el momento de "emitir" (status draft → issued).
 *     El borrador NO consume número.
 *   - Numeración correlativa por serie y año, sin huecos (obligación fiscal).
 *   - Race-safe: SELECT ... FOR UPDATE bloquea la fila de la serie hasta
 *     que la transacción termina.
 *   - Si la fecha de emisión cae en otro año al de la serie, se calcula
 *     el siguiente número real consultando el MAX existente para ese
 *     prefijo+año (evita colisiones con datos históricos).
 */
import { Op } from "sequelize";

export async function assignInvoiceNumber({ sequelize, models, seriesCode = "F", date, t }) {
  if (!t) {
    throw new Error("assignInvoiceNumber requiere una transacción explícita");
  }
  const { InvoiceSeries, Invoice } = models;

  const year = date ? new Date(date).getFullYear() : new Date().getFullYear();

  // Lock pesimista de la fila de la serie
  const series = await InvoiceSeries.findOne({
    where: { code: seriesCode },
    lock: t.LOCK.UPDATE,
    transaction: t,
  });

  if (!series) {
    throw new Error(`Serie de facturación '${seriesCode}' no encontrada`);
  }

  // Si cambió el año, calcular nextNumber consultando el MAX real
  // de facturas ya existentes con ese prefijo+año (datos históricos).
  let next = series.nextNumber;
  if (series.year !== year) {
    const pattern = `${series.prefix}-${year}-%`;
    const existing = await Invoice.findOne({
      where: { number: { [Op.like]: pattern } },
      order: [["number", "DESC"]],
      attributes: ["number"],
      transaction: t,
    });
    if (existing) {
      const m = existing.number.match(/-(\d+)$/);
      next = m ? Number(m[1]) + 1 : 1;
    } else {
      next = 1;
    }
  }

  const number = `${series.prefix}-${year}-${String(next).padStart(4, "0")}`;

  await series.update(
    { nextNumber: next + 1, year },
    { transaction: t }
  );

  return number;
}
