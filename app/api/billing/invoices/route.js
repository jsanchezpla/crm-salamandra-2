import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, error, serverError } from "../../../../lib/utils/apiResponse.js";
import { calculateInvoice } from "../../../../lib/billing/calculateInvoice.js";
import { generateInvoiceNumber } from "../../../../lib/billing/generateInvoiceNumber.js";

// GET /api/billing/invoices
export const GET = withTenant(async (request, _ctx, { tenantModels }) => {
  try {
    const { Invoice, Client, TeamMember } = tenantModels;
    const { searchParams } = new URL(request.url);

    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(100, parseInt(searchParams.get("limit") || "20"));
    const offset = (page - 1) * limit;

    const where = {};
    if (searchParams.get("status")) where.status = searchParams.get("status");
    if (searchParams.get("invoiceType")) where.invoiceType = searchParams.get("invoiceType");
    if (searchParams.get("clientId")) where.clientId = searchParams.get("clientId");
    if (searchParams.get("familyId")) where.familyId = searchParams.get("familyId");
    if (searchParams.get("therapistId")) where.therapistId = searchParams.get("therapistId");
    if (searchParams.get("from") || searchParams.get("to")) {
      where.issueDate = {};
      if (searchParams.get("from")) where.issueDate[Op.gte] = searchParams.get("from");
      if (searchParams.get("to")) where.issueDate[Op.lte] = searchParams.get("to");
    }

    const { count, rows } = await Invoice.findAndCountAll({
      where,
      include: [
        { model: Client, as: "client", attributes: ["id", "name"] },
        { model: TeamMember, as: "therapist", attributes: ["id", "displayName"] },
      ],
      order: [["issueDate", "DESC"]],
      limit,
      offset,
    });

    return ok({ invoices: rows, total: count, page, limit });
  } catch (err) {
    return serverError(err);
  }
});

// POST /api/billing/invoices
export const POST = withTenant(async (request, _ctx, { tenantModels }) => {
  try {
    const { Invoice } = tenantModels;
    const body = await request.json();

    const {
      clientId,
      familyId,
      patientId,
      therapistId,
      serviceType,
      invoiceType,
      issueDate,
      dueDate,
      lines,
      vatRate = 0,
      discountType,
      discountValue,
      recurringConfig,
      notes,
      customFields,
    } = body;

    if (!clientId) return error("clientId es obligatorio");
    if (!issueDate) return error("issueDate es obligatorio");
    if (!lines || !Array.isArray(lines) || lines.length === 0) {
      return error("Se requiere al menos una línea");
    }

    const { subtotal, discountAmount, vatAmount, total } = calculateInvoice({
      lines,
      vatRate,
      discountType,
      discountValue,
    });

    const number = await generateInvoiceNumber(Invoice);

    const invoice = await Invoice.create({
      number,
      clientId,
      familyId: familyId || null,
      patientId: patientId || null,
      therapistId: therapistId || null,
      serviceType: serviceType || null,
      invoiceType: invoiceType || null,
      issueDate,
      dueDate: dueDate || null,
      lines,
      subtotal,
      vatRate,
      vatAmount,
      total,
      discountType: discountType || null,
      discountValue: discountValue || null,
      recurringConfig: recurringConfig || {},
      notes: notes || null,
      customFields: customFields || {},
      status: "draft",
    });

    return created(invoice);
  } catch (err) {
    return serverError(err);
  }
});
