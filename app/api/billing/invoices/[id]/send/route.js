import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../../../lib/db/masterDb.js";
import { withEffectiveStatus } from "../../../../../../lib/billing/invoiceStatus.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const VALID_VIA = new Set(["email", "whatsapp", "other"]);

/**
 * POST /api/billing/invoices/[id]/send
 *
 * Marca una factura emitida como "enviada al cliente". Solo informativa
 * para tracking comercial — no afecta a cálculos de KPI.
 *
 * Acepta query opcional ?via=email|whatsapp|other como anotación. Hoy se
 * persiste en customFields.sentVia y se registra en el AuditLog. Sin
 * integraciones reales todavía.
 */
export const POST = withTenant(async (request, { params }, { tenantModels, hasModule, tenant }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const role = request.headers.get("x-user-role");
    const userId = request.headers.get("x-user-id");
    if (!ADMIN_ROLES.has(role)) return forbidden("Solo admin");

    const { id } = await params;
    const { Invoice } = tenantModels;
    const { searchParams } = new URL(request.url);
    const viaParam = searchParams.get("via");
    const via = viaParam && VALID_VIA.has(viaParam) ? viaParam : null;

    const invoice = await Invoice.findByPk(id);
    if (!invoice) return notFound("Factura no encontrada");
    if (invoice.status !== "issued") {
      return error(`Solo se pueden marcar como enviadas las facturas en estado 'issued'. Estado actual: '${invoice.status}'.`, 422);
    }

    const updates = { status: "sent" };
    if (via) {
      updates.customFields = {
        ...(invoice.customFields || {}),
        sentVia: via,
        sentAt: new Date().toISOString(),
      };
    }
    await invoice.update(updates);

    await auditLog({
      tenantId: tenant.id,
      userId,
      action: "invoice.sent",
      entity: "Invoice",
      entityId: invoice.id,
      before: { status: "issued" },
      after: { status: "sent", via },
      ip: request.headers.get("x-forwarded-for"),
    });

    return ok(withEffectiveStatus(invoice));
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
