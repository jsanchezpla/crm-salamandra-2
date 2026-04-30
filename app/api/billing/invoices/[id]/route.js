import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, noContent, error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { calculateInvoice } from "../../../../../lib/billing/calculateInvoice.js";
import { withEffectiveStatus } from "../../../../../lib/billing/invoiceStatus.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

// GET /api/billing/invoices/[id]
export const GET = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Invoice, Payment, Client, TeamMember } = tenantModels;
    const { id } = await params;

    const invoice = await Invoice.findByPk(id, {
      include: [
        { model: Payment, as: "payments" },
        { model: Client, as: "client" },
        { model: TeamMember, as: "employee", attributes: ["id", "displayName"] },
        { model: Invoice, as: "rectifies", attributes: ["id", "number", "issueDate", "total"] },
        { model: Invoice, as: "rectifiedBy", attributes: ["id", "number", "issueDate", "total"] },
      ],
    });

    if (!invoice) return notFound("Factura no encontrada");
    return ok(withEffectiveStatus(invoice));
  } catch (err) {
    return serverError(err);
  }
});

// PATCH /api/billing/invoices/[id] — solo en draft
export const PATCH = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const role = request.headers.get("x-user-role");
    if (!ADMIN_ROLES.has(role)) return forbidden("Solo admin");

    const { Invoice } = tenantModels;
    const { id } = await params;
    const body = await request.json();

    const invoice = await Invoice.findByPk(id);
    if (!invoice) return notFound("Factura no encontrada");

    if (invoice.status !== "draft") {
      return error("Solo se pueden editar facturas en borrador. Para cambios usa rectificativa.", 409);
    }

    const allowed = ["clientId", "employeeId", "issueDate", "dueDate", "lines", "notes", "customFields", "series"];
    const updates = {};
    for (const k of allowed) {
      if (k in body) updates[k] = body[k];
    }

    if (updates.lines) {
      const calc = calculateInvoice({ lines: updates.lines });
      updates.lines = calc.lines;
      updates.taxBase = calc.taxBase;
      updates.vatAmount = calc.vatAmount;
      updates.total = calc.total;
      updates.subtotal = calc.taxBase; // legacy campo, se mantiene cuadrado
    }

    await invoice.update(updates);
    return ok(invoice);
  } catch (err) {
    return serverError(err);
  }
});

// DELETE /api/billing/invoices/[id] — solo en draft
export const DELETE = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const role = request.headers.get("x-user-role");
    if (!ADMIN_ROLES.has(role)) return forbidden("Solo admin");

    const { Invoice } = tenantModels;
    const { id } = await params;

    const invoice = await Invoice.findByPk(id);
    if (!invoice) return notFound("Factura no encontrada");
    if (invoice.status !== "draft") {
      return error("Solo se pueden eliminar facturas en borrador", 409);
    }
    await invoice.destroy();
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
