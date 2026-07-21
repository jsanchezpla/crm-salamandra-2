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

  // Correlatividad CRONOLÓGICA (regla #2 — se toca /lib porque este es el único
  // punto donde se asignan números y debe garantizarse aquí): la numeración de
  // una serie debe ir en orden de fecha. No se permite emitir con fecha anterior
  // a la última factura ya emitida de esta serie+año (si no, un número mayor
  // tendría una fecha menor). La fila de la serie ya está bloqueada → sin carrera.
  const newDate = String(date ? date : new Date().toISOString()).slice(0, 10);
  const lastEmitted = await Invoice.findOne({
    where: { number: { [Op.like]: `${series.prefix}-${year}-%` } },
    order: [["issueDate", "DESC"]],
    attributes: ["issueDate", "number"],
    transaction: t,
  });
  if (lastEmitted && String(lastEmitted.issueDate).slice(0, 10) > newDate) {
    const err = new Error(
      `No se puede emitir con fecha ${newDate}: es anterior a la última factura de la serie (${lastEmitted.number}, del ${String(lastEmitted.issueDate).slice(0, 10)}). La numeración debe ir en orden de fecha.`
    );
    err.code = "OUT_OF_ORDER_DATE";
    throw err;
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
