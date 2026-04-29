/**
 * Recalcula `paidAmount` y `status` de una factura a partir de sus pagos
 * en estado `completed`. Llamar tras crear, actualizar o borrar Payments.
 *
 * Estados:
 *   - draft / cancelled / rectified → no se tocan
 *   - paid             si paidAmount >= total
 *   - partially_paid   si 0 < paidAmount < total
 *   - sent (o issued)  si paidAmount == 0 y la factura ya estaba emitida
 *
 * `paidAt` se setea solo cuando paidAmount alcanza/supera total, usando la
 * fecha del último pago aplicable.
 */
export async function updateInvoiceStatus(invoice, Payment) {
  // No tocamos estados terminales o no emitidos
  if (["draft", "cancelled", "rectified"].includes(invoice.status)) {
    return invoice;
  }

  const payments = await Payment.findAll({
    where: { invoiceId: invoice.id, status: "completed" },
    order: [["paidAt", "ASC"]],
  });

  const paidAmount = round2(
    payments.reduce((sum, p) => sum + Number(p.amount), 0)
  );
  const total = Number(invoice.total);

  let status = invoice.status;
  let paidAt = invoice.paidAt;

  if (paidAmount <= 0) {
    if (["paid", "partially_paid"].includes(status)) {
      status = "sent"; // se revierte a sent si los cobros desaparecieron
      paidAt = null;
    }
  } else if (paidAmount >= total - 0.0049) {
    status = "paid";
    const last = payments[payments.length - 1];
    paidAt = last?.paidAt ?? new Date();
  } else {
    status = "partially_paid";
    paidAt = null;
  }

  await invoice.update({ paidAmount, status, paidAt });
  return invoice;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}
