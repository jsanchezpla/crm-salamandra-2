import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, noContent, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { calculateInvoice } from "../../../../../lib/billing/calculateInvoice.js";
import { generateInvoiceNumber } from "../../../../../lib/billing/generateInvoiceNumber.js";

// GET /api/billing/recurring/[id]
export const GET = withTenant(async (request, { params }, { tenantModels }) => {
  try {
    const { RecurringInvoice, Client } = tenantModels;
    const { id } = await params;

    const recurring = await RecurringInvoice.findByPk(id, {
      include: [{ model: Client, as: "client", attributes: ["id", "name"] }],
    });

    if (!recurring) return notFound("Factura recurrente no encontrada");
    return ok(recurring);
  } catch (err) {
    return serverError(err);
  }
});

// PATCH /api/billing/recurring/[id]  — activar/desactivar, cambiar config
export const PATCH = withTenant(async (request, { params }, { tenantModels }) => {
  try {
    const { RecurringInvoice } = tenantModels;
    const { id } = await params;
    const body = await request.json();

    const recurring = await RecurringInvoice.findByPk(id);
    if (!recurring) return notFound("Factura recurrente no encontrada");

    const allowed = ["active", "frequency", "nextRunAt", "templateConfig", "familyId"];
    const updates = {};
    for (const key of allowed) {
      if (key in body) updates[key] = body[key];
    }

    await recurring.update(updates);
    return ok(recurring);
  } catch (err) {
    return serverError(err);
  }
});

// POST implícito: ejecutar manualmente — genera la factura y avanza nextRunAt
export const POST = withTenant(async (request, { params }, { tenantModels }) => {
  try {
    const { RecurringInvoice, Invoice } = tenantModels;
    const { id } = await params;

    const recurring = await RecurringInvoice.findByPk(id);
    if (!recurring) return notFound("Factura recurrente no encontrada");
    if (!recurring.active) return notFound("La factura recurrente está inactiva");

    const tmpl = recurring.templateConfig || {};
    const lines = tmpl.lines || [];
    const { subtotal, vatAmount, total } = calculateInvoice({
      lines,
      vatRate: tmpl.vatRate || 0,
      discountType: tmpl.discountType || null,
      discountValue: tmpl.discountValue || null,
    });

    const number = await generateInvoiceNumber(Invoice);
    const issueDate = new Date().toISOString().slice(0, 10);

    const invoice = await Invoice.create({
      number,
      clientId: recurring.clientId,
      familyId: recurring.familyId || null,
      invoiceType: "subscription",
      issueDate,
      lines,
      subtotal,
      vatRate: tmpl.vatRate || 0,
      vatAmount,
      total,
      discountType: tmpl.discountType || null,
      discountValue: tmpl.discountValue || null,
      recurringConfig: { recurringInvoiceId: recurring.id },
      notes: tmpl.notes || null,
      customFields: {},
      status: "draft",
    });

    // Calcular próxima ejecución
    const next = new Date(recurring.nextRunAt);
    if (recurring.frequency === "weekly") next.setDate(next.getDate() + 7);
    else if (recurring.frequency === "biweekly") next.setDate(next.getDate() + 14);
    else next.setMonth(next.getMonth() + 1);

    await recurring.update({ nextRunAt: next });

    return ok({ invoice, nextRunAt: next });
  } catch (err) {
    return serverError(err);
  }
});

// DELETE /api/billing/recurring/[id]
export const DELETE = withTenant(async (request, { params }, { tenantModels }) => {
  try {
    const { RecurringInvoice } = tenantModels;
    const { id } = await params;

    const recurring = await RecurringInvoice.findByPk(id);
    if (!recurring) return notFound("Factura recurrente no encontrada");

    await recurring.destroy();
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
