import { Op, literal } from "sequelize";

/**
 * Alcance de facturas "vivas" para TODO agregado financiero (Facturado,
 * Cobrado, Libro IVA / Modelo 303, analíticas por cliente/socio/empleado).
 *
 * Excluye dos cosas:
 *   1) Estados no computables: draft, cancelled, rectified.
 *   2) La rectificativa que ANULA por completo a una original ya excluida
 *      (la original está en 'rectified'). Sin (2), la original excluida y su
 *      rectificativa negativa —que sí contaría— restarían DOS VECES el importe
 *      (Facturado, IVA repercutido, analíticas). Con (2), el par anulado
 *      desaparece limpio y el periodo neto queda a 0.
 *
 * Importante: las rectificativas PARCIALES (por diferencias) NO se excluyen —
 * su original sigue ACTIVA, así que ambas cuentan y el neto = importe corregido.
 * Se identifican porque su `rectifies_invoice_id` apunta a una factura que NO
 * está en 'rectified'.
 *
 * Se combina con el resto de condiciones del where (clientId, employeeId,
 * issueDate…) por spread: `{ ...activeInvoiceScope(Invoice), issueDate: ... }`.
 */
export const ACTIVE_STATUSES = { [Op.notIn]: ["draft", "cancelled", "rectified"] };

/** Nombre de tabla cualificado por schema del tenant, para la subconsulta. */
function invoicesTable(Invoice) {
  const table = Invoice.tableName || "invoices";
  const schema =
    Invoice._schema ||
    Invoice.options?.schema ||
    Invoice.sequelize?.options?.searchPath ||
    Invoice.sequelize?.options?.schema ||
    null;
  return schema ? `"${schema}"."${table}"` : `"${table}"`;
}

export function activeInvoiceScope(Invoice) {
  const tbl = invoicesTable(Invoice);
  return {
    status: ACTIVE_STATUSES,
    [Op.and]: [
      literal(
        `(rectifies_invoice_id IS NULL OR rectifies_invoice_id NOT IN (SELECT id FROM ${tbl} WHERE status = 'rectified'))`
      ),
    ],
  };
}
