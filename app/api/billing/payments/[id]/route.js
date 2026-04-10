import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { updateInvoiceStatus } from "../../../../../lib/billing/updateInvoiceStatus.js";

// GET /api/billing/payments/[id]
export const GET = withTenant(async (request, { params }, { tenantModels }) => {
  try {
    const { Payment, Invoice } = tenantModels;
    const { id } = await params;

    const payment = await Payment.findByPk(id, {
      include: [{ model: Invoice, as: "invoice" }],
    });

    if (!payment) return notFound("Cobro no encontrado");
    return ok(payment);
  } catch (err) {
    return serverError(err);
  }
});

// PATCH /api/billing/payments/[id]  — principalmente para marcar como failed
export const PATCH = withTenant(async (request, { params }, { tenantModels }) => {
  try {
    const { Payment, Invoice } = tenantModels;
    const { id } = await params;
    const body = await request.json();

    const payment = await Payment.findByPk(id);
    if (!payment) return notFound("Cobro no encontrado");
    if (payment.status === "failed") return error("El cobro ya está marcado como fallido");

    const allowed = ["status", "notes", "method"];
    const updates = {};
    for (const key of allowed) {
      if (key in body) updates[key] = body[key];
    }

    await payment.update(updates);

    // Recalcular estado de la factura asociada
    const invoice = await Invoice.findByPk(payment.invoiceId);
    if (invoice) await updateInvoiceStatus(invoice, Payment);

    return ok(payment);
  } catch (err) {
    return serverError(err);
  }
});
