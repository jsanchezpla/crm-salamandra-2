import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { logBillingAudit, resumenImporte, datosPeticion } from "../../../../lib/billing/audit.js";
import { ok, created, error, forbidden, notFound, serverError } from "../../../../lib/utils/apiResponse.js";
import { updateInvoiceStatus } from "../../../../lib/billing/updateInvoiceStatus.js";
import { parseSortOrder } from "../../../../lib/billing/parseSort.js";

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Payment, Invoice } = tenantModels;
    const { searchParams } = new URL(request.url);

    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(100, parseInt(searchParams.get("limit") || "50"));
    const offset = (page - 1) * limit;

    const where = {};
    if (searchParams.get("invoiceId")) where.invoiceId = searchParams.get("invoiceId");
    if (searchParams.get("status")) where.status = searchParams.get("status");
    if (searchParams.get("method")) where.method = searchParams.get("method");
    if (searchParams.get("from") || searchParams.get("to")) {
      where.paidAt = {};
      if (searchParams.get("from")) where.paidAt[Op.gte] = `${searchParams.get("from")} 00:00:00`;
      if (searchParams.get("to")) where.paidAt[Op.lte] = `${searchParams.get("to")} 23:59:59`;
    }

    const allowedSort = {
      paidAt: "paidAt",
      amount: "amount",
      method: "method",
      status: "status",
      "invoice.number": [{ model: Invoice, as: "invoice" }, "number"],
    };
    const order = parseSortOrder(
      searchParams.get("sortBy"),
      searchParams.get("sortDir"),
      allowedSort,
      [["paidAt", "DESC"]]
    );

    const { count, rows } = await Payment.findAndCountAll({
      where,
      include: [{ model: Invoice, as: "invoice", attributes: ["id", "number", "total", "status", "clientId", "issueDate"] }],
      order,
      limit, offset,
    });

    return ok({ payments: rows, total: count, page, limit });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, _ctx, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const role = request.headers.get("x-user-role");
    if (!new Set(["admin", "superadmin"]).has(role)) return forbidden("Solo admin");

    const { Payment, Invoice } = tenantModels;
    const body = await request.json();
    const { invoiceId, amount, paidAt, method, notes } = body;

    if (!invoiceId) return error("invoiceId es obligatorio");
    if (!amount || Number(amount) <= 0) return error("amount debe ser mayor que 0");
    if (!method) return error("method es obligatorio");
    if (!paidAt) return error("paidAt es obligatorio");

    const invoice = await Invoice.findByPk(invoiceId);
    if (!invoice) return notFound("Factura no encontrada");
    if (["draft", "cancelled", "rectified"].includes(invoice.status)) {
      return error(`No se puede registrar un cobro en una factura en estado '${invoice.status}'`, 409);
    }

    const remaining = Number(invoice.total) - Number(invoice.paidAmount);
    if (Number(amount) > remaining + 0.0049) {
      return error(`El importe (${Number(amount)}) excede el pendiente de la factura (${remaining.toFixed(2)})`, 400);
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

    await logBillingAudit({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "payment.created",
      entity: "Payment",
      entityId: payment.id,
      before: null,
      after: resumenImporte(payment),
    });
    return created(payment);
  } catch (err) {
    return serverError(err);
  }
});
