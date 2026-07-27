import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { calculateInvoice } from "../../../../../../lib/billing/calculateInvoice.js";

const ADMIN_ROLES = new Set(["admin", "superadmin", "manager"]);

/**
 * POST /api/billing/quotes/[id]/convert
 *
 * Convierte un presupuesto en una FACTURA BORRADOR (no fiscal aún: la factura
 * se emite —y numera y registra en Verifactu— después, desde su propio flujo).
 * Hereda cliente, proyecto, empleado y líneas. Deja trazabilidad en ambos
 * sentidos: quote.convertedInvoiceId ↔ invoice.customFields.sourceQuote*.
 */
export const POST = withTenant(async (request, { params }, { tenantModels, tenantSequelize, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const role = request.headers.get("x-user-role");
    if (!ADMIN_ROLES.has(role)) return forbidden("Sin permiso para convertir presupuestos");

    const { Quote, Invoice, TenantBillingSettings } = tenantModels;
    const { id } = await params;

    const quote = await Quote.findByPk(id);
    if (!quote) return notFound("Presupuesto no encontrado");
    if (quote.status === "converted" || quote.convertedInvoiceId) {
      return error("Este presupuesto ya se convirtió en factura", 409);
    }

    const settings = await TenantBillingSettings.findOne();
    const termsDays = settings ? Number(settings.defaultPaymentTermsDays ?? 30) : 30;
    // Fallback 0 (no 15, resto legacy): desde el sprint fiscal el IRPF solo se
    // aplica si el tenant lo configura (autónomo profesional). Sin settings → 0.
    const defaultIrpf = settings ? Number(settings.defaultIrpfRate ?? 0) : 0;

    const issueDate = new Date().toISOString().slice(0, 10);
    let dueDate = null;
    if (Number.isFinite(termsDays) && termsDays > 0) {
      const d = new Date(issueDate);
      d.setDate(d.getDate() + termsDays);
      dueDate = d.toISOString().slice(0, 10);
    }

    // Recalcular por seguridad (las líneas del presupuesto ya traen vatRate).
    // La factura resultante aplica IRPF por defecto del tenant.
    const calc = calculateInvoice({ lines: Array.isArray(quote.lines) ? quote.lines : [], irpfRate: defaultIrpf });

    const result = await tenantSequelize.transaction(async (t) => {
      const invoice = await Invoice.create(
        {
          clientId: quote.clientId,
          projectId: quote.projectId || null,
          employeeId: quote.employeeId || null,
          issueDate,
          dueDate,
          lines: calc.lines,
          taxBase: calc.taxBase,
          vatAmount: calc.vatAmount,
          irpfRate: calc.irpfRate,
          irpfAmount: calc.irpfAmount,
          total: calc.total,
          paidAmount: 0,
          series: "F",
          number: `DRAFT-${quote.number}`,
          status: "draft",
          notes: quote.notes || null,
          customFields: {
            ...(quote.customFields || {}),
            sourceQuoteId: quote.id,
            sourceQuoteNumber: quote.number,
          },
          subtotal: calc.taxBase,
          vatRate: 0,
        },
        { transaction: t }
      );

      await quote.update(
        { status: "converted", convertedInvoiceId: invoice.id, convertedAt: new Date() },
        { transaction: t }
      );

      return invoice;
    });

    return ok({ invoice: result, quoteId: quote.id });
  } catch (err) {
    return serverError(err);
  }
});
