/**
 * Asigna número de factura usando InvoiceSeries.
 *
 * Reglas:
 *   - El número se asigna SOLO en el momento de "emitir" (status draft → issued).
 *     El borrador NO consume número.
 *   - Numeración correlativa por serie y año, sin huecos (obligación fiscal).
 *   - Race-safe: SELECT ... FOR UPDATE bloquea la fila de la serie hasta
 *     que la transacción termina.
 *   - Cómo se ESCRIBE el número lo dice el formato de la serie
 *     (lib/billing/formatoDeSerie.js): `F-2026-0001` si no tiene ninguno, o el
 *     de otro programa cuya numeración se continúa (`C2602246`, 12/09/2026).
 *   - El contador nunca va por detrás de lo que ya existe en la serie y el
 *     año: si hay facturas traídas de fuera con números más altos (las de
 *     Organízate que Aumenta sigue emitiendo hasta el 30/09/2026), la
 *     siguiente sale detrás de la mayor, no encima de ella. La misma regla
 *     cubre el cambio de año: en enero no hay ninguna y se empieza por el 1.
 */
import { Op, fn, col } from "sequelize";
import { numeroDeSerie, regexDeSerie, correlativoDe } from "./formatoDeSerie.js";

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

  // Los números de ESTA serie y ESTE año, reconocidos por su formato. La
  // expresión vale tal cual en Postgres: solo lleva [0-9], llaves de
  // repetición, anclas y literales escapados.
  const deLaSerie = { number: { [Op.regexp]: regexDeSerie(series, year).source } };

  // Correlatividad CRONOLÓGICA (regla #2 — se toca /lib porque este es el único
  // punto donde se asignan números y debe garantizarse aquí): la numeración de
  // una serie debe ir en orden de fecha. No se permite emitir con fecha anterior
  // a la última factura ya emitida de esta serie+año (si no, un número mayor
  // tendría una fecha menor). La fila de la serie ya está bloqueada → sin carrera.
  const newDate = String(date ? date : new Date().toISOString()).slice(0, 10);
  const lastEmitted = await Invoice.findOne({
    where: deLaSerie,
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

  // El mayor número que ya existe de la serie y el año: por largo y luego por
  // texto (con relleno fijo el orden de texto es el numérico, y si algún día
  // el correlativo desborda el relleno, el más largo es el mayor).
  const mayor = await Invoice.findOne({
    where: deLaSerie,
    order: [[fn("length", col("number")), "DESC"], ["number", "DESC"]],
    attributes: ["number"],
    transaction: t,
  });
  const trasLosQueHay = mayor ? (correlativoDe(series, year, mayor.number) ?? 0) + 1 : 1;
  const delContador = series.year === year ? Number(series.nextNumber) || 1 : 1;
  const next = Math.max(delContador, trasLosQueHay);

  const number = numeroDeSerie(series, { year, n: next });

  await series.update(
    { nextNumber: next + 1, year },
    { transaction: t }
  );

  return number;
}
