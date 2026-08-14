import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { logBillingAudit, datosPeticion } from "../../../../../lib/billing/audit.js";
import { ok, noContent, error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { calculateInvoice } from "../../../../../lib/billing/calculateInvoice.js";


// GET /api/billing/quotes/[id] — detalle
export const GET = withTenant(async (_request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Quote, Client, TeamMember, Project, Invoice } = tenantModels;
    const { id } = await params;

    const quote = await Quote.findByPk(id, {
      include: [
        { model: Client, as: "client", attributes: ["id", "name", "fiscalName", "taxId", "customFields"] },
        { model: TeamMember, as: "employee", attributes: ["id", "displayName"] },
        { model: Project, as: "project", attributes: ["id", "name", "code"] },
        { model: Invoice, as: "convertedInvoice", attributes: ["id", "number", "status", "total"] },
      ],
    });
    if (!quote) return notFound("Presupuesto no encontrado");
    return ok(quote);
  } catch (err) {
    return serverError(err);
  }
});

// PATCH /api/billing/quotes/[id] — editar (líneas, estado, datos)
export const PATCH = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");

    const { Quote, TenantBillingSettings } = tenantModels;
    const { id } = await params;
    const body = await request.json();

    const quote = await Quote.findByPk(id);
    if (!quote) return notFound("Presupuesto no encontrado");
    if (quote.status === "converted") {
      return error("No se puede editar un presupuesto ya convertido en factura", 409);
    }

    const patch = {};

    if (Array.isArray(body.lines)) {
      const settings = await TenantBillingSettings.findOne();
      const defaultVat = settings ? Number(settings.defaultVatRate) : 21;
      const linesWithVat = body.lines.map((l) => ({
        ...l,
        vatRate: l.vatRate != null ? Number(l.vatRate) : defaultVat,
      }));
      const calc = calculateInvoice({ lines: linesWithVat });
      patch.lines = calc.lines;
      patch.taxBase = calc.taxBase;
      patch.vatAmount = calc.vatAmount;
      patch.total = calc.total;
    }

    if ("clientId" in body && body.clientId) patch.clientId = body.clientId;
    if ("projectId" in body) patch.projectId = body.projectId || null;
    if ("employeeId" in body) patch.employeeId = body.employeeId || null;
    if ("issueDate" in body && body.issueDate) patch.issueDate = body.issueDate;
    if ("validUntil" in body) patch.validUntil = body.validUntil || null;
    if ("notes" in body) patch.notes = body.notes?.trim() || null;
    if ("customFields" in body) patch.customFields = body.customFields || {};

    // Cambios de estado permitidos manualmente (accept/convert tienen endpoint propio)
    if ("status" in body) {
      const allowed = new Set(["draft", "sent", "viewed", "rejected", "expired"]);
      if (!allowed.has(body.status)) {
        return error(`Cambio de estado '${body.status}' no permitido por esta vía`, 422);
      }
      patch.status = body.status;
      const now = new Date();
      if (body.status === "sent" && !quote.sentAt) patch.sentAt = now;
      if (body.status === "viewed" && !quote.viewedAt) patch.viewedAt = now;
      if (body.status === "rejected") patch.rejectedAt = now;
    }

    await quote.update(patch);
    return ok(quote);
  } catch (err) {
    return serverError(err);
  }
});

// DELETE /api/billing/quotes/[id]
export const DELETE = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");

    const { Quote } = tenantModels;
    const { id } = await params;
    const quote = await Quote.findByPk(id);
    if (!quote) return notFound("Presupuesto no encontrado");

    if (quote.status === "converted" || quote.convertedInvoiceId) {
      return error("No se puede borrar un presupuesto convertido en factura", 409);
    }

    const antes = { numero: quote.number ?? null, estado: quote.status ?? null, total: quote.total != null ? String(quote.total) : null };
    const idPres = quote.id;
    await quote.destroy();
    await logBillingAudit({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "quote.deleted",
      entity: "Quote",
      entityId: idPres,
      before: antes,
      after: null,
    });
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
