import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, noContent, error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { updateInvoiceStatus } from "../../../../../lib/billing/updateInvoiceStatus.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const VALID_STATUS = new Set(["pending", "completed", "failed", "refunded"]);

export const GET = withTenant(async (_request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
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

export const PATCH = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const role = request.headers.get("x-user-role");
    if (!ADMIN_ROLES.has(role)) return forbidden("Solo admin");

    const { Payment, Invoice } = tenantModels;
    const { id } = await params;
    const body = await request.json();
    const payment = await Payment.findByPk(id);
    if (!payment) return notFound("Cobro no encontrado");

    const allowed = ["status", "notes", "method", "amount", "paidAt"];
    const updates = {};
    for (const k of allowed) {
      if (k in body) updates[k] = body[k];
    }
    if (updates.status && !VALID_STATUS.has(updates.status)) {
      return error("status inválido");
    }
    if (updates.amount != null && Number(updates.amount) <= 0) {
      return error("amount debe ser mayor que 0");
    }

    await payment.update(updates);

    const invoice = await Invoice.findByPk(payment.invoiceId);
    if (invoice) await updateInvoiceStatus(invoice, Payment);

    return ok(payment);
  } catch (err) {
    return serverError(err);
  }
});

export const DELETE = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const role = request.headers.get("x-user-role");
    if (!ADMIN_ROLES.has(role)) return forbidden("Solo admin");

    const { Payment, Invoice } = tenantModels;
    const { id } = await params;
    const payment = await Payment.findByPk(id);
    if (!payment) return notFound("Cobro no encontrado");

    const invoiceId = payment.invoiceId;
    await payment.destroy();
    const invoice = await Invoice.findByPk(invoiceId);
    if (invoice) await updateInvoiceStatus(invoice, Payment);
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
