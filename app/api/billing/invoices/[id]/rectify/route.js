import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { calculateInvoice } from "../../../../../../lib/billing/calculateInvoice.js";
import { assignInvoiceNumber } from "../../../../../../lib/billing/generateInvoiceNumber.js";
import { getMasterModels } from "../../../../../../lib/db/masterDb.js";
import { withEffectiveStatus } from "../../../../../../lib/billing/invoiceStatus.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * POST /api/billing/invoices/[id]/rectify
 *
 * Crea una factura rectificativa que ANULA la original (línea negativa
 * con los mismos importes pero invertidos). Marca la original como
 * `rectified` y enlaza ambas. La rectificativa se emite directamente
 * (no pasa por draft).
 *
 * Body opcional:
 *   { issueDate: 'YYYY-MM-DD', notes: '...' }
 */
export const POST = withTenant(async (request, { params }, { tenantModels, hasModule, tenant }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const role = request.headers.get("x-user-role");
    const userId = request.headers.get("x-user-id");
    if (!ADMIN_ROLES.has(role)) return forbidden("Solo admin");

    const { id } = await params;
    const { Invoice, InvoiceSeries } = tenantModels;

    const original = await Invoice.findByPk(id);
    if (!original) return notFound("Factura no encontrada");
    if (!["issued", "sent", "paid", "partially_paid", "overdue"].includes(original.status)) {
      return error(`No se puede rectificar una factura en estado '${original.status}'`, 409);
    }
    if (original.rectifiedByInvoiceId) {
      return error("Esta factura ya está rectificada", 409);
    }

    const body = await request.json().catch(() => ({}));
    const issueDate = body.issueDate || new Date().toISOString().slice(0, 10);
    const notes = body.notes || `Rectificativa de ${original.number}`;

    // Líneas con importes invertidos (negativos)
    const inverted = (Array.isArray(original.lines) ? original.lines : []).map((l) => ({
      description: `Rectificación: ${l.description ?? ""}`.trim(),
      quantity: -Number(l.quantity ?? 0),
      unitPrice: Number(l.unitPrice ?? 0),
      discountPct: Number(l.discountPct ?? 0),
      vatRate: Number(l.vatRate ?? 0),
    }));
    const calc = calculateInvoice({ lines: inverted });

    // Series 'R' por defecto
    const rectiSeries = await InvoiceSeries.findOne({ where: { kind: "rectificative" } });
    const seriesCode = rectiSeries?.code ?? "R";

    const sequelize = original.sequelize;
    const result = await sequelize.transaction(async (t) => {
      const number = await assignInvoiceNumber({
        sequelize,
        models: tenantModels,
        seriesCode,
        date: issueDate,
        t,
      });

      const rect = await Invoice.create({
        clientId: original.clientId,
        employeeId: original.employeeId,
        issueDate,
        dueDate: null,
        lines: calc.lines,
        taxBase: calc.taxBase,
        vatAmount: calc.vatAmount,
        total: calc.total,
        paidAmount: 0,
        series: seriesCode,
        number,
        status: "issued",
        notes,
        customFields: {},
        subtotal: calc.taxBase,
        vatRate: 0,
        rectifiesInvoiceId: original.id,
      }, { transaction: t });

      await original.update(
        { status: "rectified", rectifiedByInvoiceId: rect.id },
        { transaction: t }
      );

      return rect;
    });

    await auditLog({
      tenantId: tenant.id,
      userId,
      action: "invoice.rectified",
      entity: "Invoice",
      entityId: original.id,
      before: { status: original.status },
      after: { status: "rectified", rectifiedByInvoiceId: result.id, rectifyingNumber: result.number },
      ip: request.headers.get("x-forwarded-for"),
    });

    await result.reload();
    return ok(withEffectiveStatus(result));
  } catch (err) {
    return serverError(err);
  }
});

async function auditLog(data) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create(data);
  } catch {}
}
