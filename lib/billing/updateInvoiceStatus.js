import { Op } from "sequelize";

/**
 * Recalcula el estado de una factura en función de los cobros completados.
 * Llama a esto después de crear, modificar o eliminar un Payment.
 */
export async function updateInvoiceStatus(invoice, Payment) {
  const payments = await Payment.findAll({
    where: { invoiceId: invoice.id, status: "completed" },
  });

  const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const invoiceTotal = Number(invoice.total);

  let status = invoice.status;
  let paidAt = invoice.paidAt;

  if (totalPaid <= 0) {
    // Sin cobros — volver a enviada si estaba en camino, no tocar draft/cancelled
    if (["partial", "paid"].includes(status)) status = "sent";
  } else if (totalPaid >= invoiceTotal) {
    status = "paid";
    paidAt = paidAt || new Date();
  } else {
    status = "partial";
    paidAt = null;
  }

  await invoice.update({ status, paidAt });
  return invoice;
}
