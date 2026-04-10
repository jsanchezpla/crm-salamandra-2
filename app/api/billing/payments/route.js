import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, error, notFound, serverError } from "../../../../lib/utils/apiResponse.js";
import { updateInvoiceStatus } from "../../../../lib/billing/updateInvoiceStatus.js";

// GET /api/billing/payments
export const GET = withTenant(async (request, _ctx, { tenantModels }) => {
  try {
    const { Payment, Invoice } = tenantModels;
    const { searchParams } = new URL(request.url);

    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(100, parseInt(searchParams.get("limit") || "20"));
    const offset = (page - 1) * limit;

    const where = {};
    if (searchParams.get("invoiceId")) where.invoiceId = searchParams.get("invoiceId");
    if (searchParams.get("status")) where.status = searchParams.get("status");
    if (searchParams.get("method")) where.method = searchParams.get("method");

    const { count, rows } = await Payment.findAndCountAll({
      where,
      include: [{ model: Invoice, as: "invoice", attributes: ["id", "number", "total", "status"] }],
      order: [["paidAt", "DESC"]],
      limit,
      offset,
    });

    return ok({ payments: rows, total: count, page, limit });
  } catch (err) {
    return serverError(err);
  }
});

// POST /api/billing/payments
export const POST = withTenant(async (request, _ctx, { tenantModels }) => {
  try {
    const { Payment, Invoice } = tenantModels;
    const body = await request.json();

    const { invoiceId, amount, paidAt, method, notes } = body;

    if (!invoiceId) return error("invoiceId es obligatorio");
    if (!amount || Number(amount) <= 0) return error("amount debe ser mayor que 0");
    if (!method) return error("method es obligatorio");
    if (!paidAt) return error("paidAt es obligatorio");

    const invoice = await Invoice.findByPk(invoiceId);
    if (!invoice) return notFound("Factura no encontrada");
    if (["cancelled", "draft"].includes(invoice.status)) {
      return error("No se puede registrar un cobro en una factura en estado " + invoice.status);
    }

    const payment = await Payment.create({
      invoiceId,
      amount: Number(amount),
      paidAt,
      method,
      status: "completed",
      notes: notes || null,
    });

    await updateInvoiceStatus(invoice, Payment);

    return created(payment);
  } catch (err) {
    return serverError(err);
  }
});
