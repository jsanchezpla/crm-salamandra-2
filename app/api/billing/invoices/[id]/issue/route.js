import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { assignInvoiceNumber } from "../../../../../../lib/billing/generateInvoiceNumber.js";
import { getMasterModels } from "../../../../../../lib/db/masterDb.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * POST /api/billing/invoices/[id]/issue
 *
 * Pasa la factura de draft → issued. Asigna número correlativo de la serie
 * dentro de una transacción explícita con FOR UPDATE para garantizar
 * unicidad y correlatividad sin huecos.
 */
export const POST = withTenant(async (request, { params }, { tenantModels, hasModule, tenant }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const role = request.headers.get("x-user-role");
    const userId = request.headers.get("x-user-id");
    if (!ADMIN_ROLES.has(role)) return forbidden("Solo admin");

    const { id } = await params;
    const { Invoice, Client } = tenantModels;

    const invoice = await Invoice.findByPk(id, {
      include: [{ model: Client, as: "client" }],
    });
    if (!invoice) return notFound("Factura no encontrada");
    if (invoice.status !== "draft") {
      return error("Solo se pueden emitir facturas en borrador", 409);
    }
    if (!Array.isArray(invoice.lines) || invoice.lines.length === 0) {
      return error("La factura no tiene líneas", 400);
    }
    if (Number(invoice.total) <= 0) {
      return error("La factura no tiene importe", 400);
    }
    // Bloqueo fiscal: cliente debe tener al menos fiscalName y taxId.
    // Sin esos datos la factura no es legalmente válida.
    const c = invoice.client;
    const missing = [];
    if (!c?.fiscalName && !c?.name) missing.push("razón social");
    if (!c?.taxId) missing.push("NIF/CIF");
    if (missing.length > 0) {
      return error(
        `El cliente no tiene datos fiscales completos: falta ${missing.join(" y ")}. Edita la ficha del cliente antes de emitir.`,
        422
      );
    }

    const sequelize = invoice.sequelize;
    const number = await sequelize.transaction(async (t) => {
      const num = await assignInvoiceNumber({
        sequelize,
        models: tenantModels,
        seriesCode: invoice.series || "F",
        date: invoice.issueDate,
        t,
      });
      await invoice.update({ number: num, status: "issued" }, { transaction: t });
      return num;
    });

    await auditLog({
      tenantId: tenant.id,
      userId,
      action: "invoice.issued",
      entity: "Invoice",
      entityId: invoice.id,
      after: { number, status: "issued" },
      ip: request.headers.get("x-forwarded-for"),
    });

    await invoice.reload();
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
