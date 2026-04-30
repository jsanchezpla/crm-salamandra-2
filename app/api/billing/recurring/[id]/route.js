import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, noContent, error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { calculateInvoice } from "../../../../../lib/billing/calculateInvoice.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const ADMIN_DENY = "Solo administradores pueden gestionar facturas recurrentes";

// GET /api/billing/recurring/[id]
export const GET = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
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
export const PATCH = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const role = request.headers.get("x-user-role");
    if (!ADMIN_ROLES.has(role)) return forbidden(ADMIN_DENY);

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

// POST /api/billing/recurring/[id]
//   Genera una factura DRAFT a partir del template y avanza nextRunAt.
//   El draft no consume número de serie; el usuario lo emite después
//   desde /facturacion/facturas con el botón "Emitir".
export const POST = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const role = request.headers.get("x-user-role");
    if (!ADMIN_ROLES.has(role)) return forbidden(ADMIN_DENY);

    const { RecurringInvoice, Invoice } = tenantModels;
    const { id } = await params;

    const recurring = await RecurringInvoice.findByPk(id);
    if (!recurring) return notFound("Factura recurrente no encontrada");
    if (!recurring.active) return notFound("La factura recurrente está inactiva");

    const tmpl = recurring.templateConfig || {};
    // Línea única derivada del template (los seeds antiguos guardaban
    // description/taxBase/vatRate planos en templateConfig).
    const lines = Array.isArray(tmpl.lines) && tmpl.lines.length > 0
      ? tmpl.lines
      : [{
          description: tmpl.description || "Factura recurrente",
          quantity: 1,
          unitPrice: Number(tmpl.taxBase ?? 0),
          discountPct: 0,
          vatRate: Number(tmpl.vatRate ?? 21),
        }];

    const calc = calculateInvoice({ lines });
    const issueDate = new Date().toISOString().slice(0, 10);

    const invoice = await Invoice.create({
      clientId: recurring.clientId,
      issueDate,
      lines: calc.lines,
      taxBase: calc.taxBase,
      vatAmount: calc.vatAmount,
      total: calc.total,
      paidAmount: 0,
      series: "F",
      number: `DRAFT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      status: "draft",
      notes: tmpl.notes || `Generada desde recurrente ${recurring.id}`,
      customFields: {},
      recurringConfig: { recurringInvoiceId: recurring.id },
      // legacy
      subtotal: calc.taxBase,
      vatRate: 0,
    });

    // Avanzar próxima ejecución
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
export const DELETE = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const role = request.headers.get("x-user-role");
    if (!ADMIN_ROLES.has(role)) return forbidden(ADMIN_DENY);

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
