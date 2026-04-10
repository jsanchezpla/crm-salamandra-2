import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, noContent, error, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { calculateInvoice } from "../../../../../lib/billing/calculateInvoice.js";

// GET /api/billing/invoices/[id]
export const GET = withTenant(async (request, { params }, { tenantModels }) => {
  try {
    const { Invoice, Payment, Client, TeamMember } = tenantModels;
    const { id } = await params;

    const invoice = await Invoice.findByPk(id, {
      include: [
        { model: Payment, as: "payments" },
        { model: Client, as: "client", attributes: ["id", "name", "email"] },
        { model: TeamMember, as: "therapist", attributes: ["id", "displayName"] },
      ],
    });

    if (!invoice) return notFound("Factura no encontrada");
    return ok(invoice);
  } catch (err) {
    return serverError(err);
  }
});

// PATCH /api/billing/invoices/[id]
export const PATCH = withTenant(async (request, { params }, { tenantModels }) => {
  try {
    const { Invoice } = tenantModels;
    const { id } = await params;
    const body = await request.json();

    const invoice = await Invoice.findByPk(id);
    if (!invoice) return notFound("Factura no encontrada");

    if (invoice.status === "cancelled") {
      return error("No se puede modificar una factura cancelada");
    }

    const allowed = [
      "familyId", "patientId", "therapistId", "serviceType", "invoiceType",
      "dueDate", "lines", "vatRate", "discountType", "discountValue",
      "recurringConfig", "notes", "status", "customFields",
    ];

    const updates = {};
    for (const key of allowed) {
      if (key in body) updates[key] = body[key];
    }

    // Recalcular totales si cambian líneas o descuentos
    if (updates.lines || updates.vatRate !== undefined || updates.discountType || updates.discountValue !== undefined) {
      const { subtotal, discountAmount, vatAmount, total } = calculateInvoice({
        lines: updates.lines ?? invoice.lines,
        vatRate: updates.vatRate ?? invoice.vatRate,
        discountType: updates.discountType ?? invoice.discountType,
        discountValue: updates.discountValue ?? invoice.discountValue,
      });
      Object.assign(updates, { subtotal, vatAmount, total });
    }

    await invoice.update(updates);
    return ok(invoice);
  } catch (err) {
    return serverError(err);
  }
});

// DELETE /api/billing/invoices/[id]  — solo borrables en estado draft
export const DELETE = withTenant(async (request, { params }, { tenantModels }) => {
  try {
    const { Invoice } = tenantModels;
    const { id } = await params;

    const invoice = await Invoice.findByPk(id);
    if (!invoice) return notFound("Factura no encontrada");
    if (invoice.status !== "draft") {
      return error("Solo se pueden eliminar facturas en estado borrador", 409);
    }

    await invoice.destroy();
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
