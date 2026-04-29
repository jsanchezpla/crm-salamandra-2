import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../../../lib/db/masterDb.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * POST /api/billing/invoices/[id]/cancel
 *
 * Cancela una factura. Solo permitido en draft (anular borrador) o
 * en issued/sent SIN cobros. Si tiene cobros, hay que rectificar, no
 * cancelar.
 */
export const POST = withTenant(async (request, { params }, { tenantModels, hasModule, tenant }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const role = request.headers.get("x-user-role");
    const userId = request.headers.get("x-user-id");
    if (!ADMIN_ROLES.has(role)) return forbidden("Solo admin");

    const { id } = await params;
    const { Invoice } = tenantModels;

    const invoice = await Invoice.findByPk(id);
    if (!invoice) return notFound("Factura no encontrada");

    if (!["draft", "issued", "sent"].includes(invoice.status)) {
      return error(`No se puede cancelar una factura en estado '${invoice.status}'. Usa rectificativa.`, 409);
    }
    if (Number(invoice.paidAmount) > 0) {
      return error("La factura tiene cobros. Refunde los cobros antes de cancelar, o emite rectificativa.", 409);
    }

    const before = { status: invoice.status };
    await invoice.update({ status: "cancelled" });

    await auditLog({
      tenantId: tenant.id,
      userId,
      action: "invoice.cancelled",
      entity: "Invoice",
      entityId: invoice.id,
      before,
      after: { status: "cancelled" },
      ip: request.headers.get("x-forwarded-for"),
    });

    return ok(invoice);
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
