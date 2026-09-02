import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { assignInvoiceNumber } from "../../../../../../lib/billing/generateInvoiceNumber.js";
import { getMasterModels } from "../../../../../../lib/db/masterDb.js";
import { withEffectiveStatus } from "../../../../../../lib/billing/invoiceStatus.js";
import { applyStockMovementsForInvoice } from "../../../../../../lib/inventory/applyStockMovementsForInvoice.js";

import { nifDeCliente } from "../../../../../../lib/billing/nifCliente.js";
import { fotoFiscalDe, tutorDe, fotoFiscalDeTutor, faltaParaEmitirATutor } from "../../../../../../lib/billing/datosFiscales.js";

/**
 * POST /api/billing/invoices/[id]/issue
 *
 * Pasa la factura de draft → issued. Asigna número correlativo de la serie
 * dentro de una transacción explícita con FOR UPDATE para garantizar
 * unicidad y correlatividad sin huecos.
 */
export const POST = withTenant(async (request, { params }, { tenantModels, hasModule, tenantHasModule, tenant }) => {
  // Captura warnings del hook de inventario para devolverlos al cliente sin
  // bloquear la emisión (stock insuficiente, receta sin definir, etc.).
  const inventoryWarnings = [];
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const userId = request.headers.get("x-user-id");

    const { id } = await params;
    const { Invoice, Client, TenantBillingSettings } = tenantModels;

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
    // Bloqueo fiscal: cliente debe tener al menos razón social y NIF/CIF.
    // Sin esos datos la factura no es legalmente válida.
    //
    // El NIF sale de `nifDeCliente`, que prefiere el de FACTURACIÓN (a nombre
    // de quién se emite) y cae al de la ficha. Sin ese respaldo, los clientes
    // que son empresas —cuyo `taxId` YA es su CIF— dejarían de poder emitir.
    const c = invoice.client;
    // A nombre de un TUTOR (02/09/2026): lo que tiene que estar completo es el
    // tutor —nombre y DNI—, no la razón social de la familia.
    const tutor = invoice.guardianId ? tutorDe(c, invoice.guardianId) : null;
    if (invoice.guardianId) {
      const falta = faltaParaEmitirATutor(invoice, c);
      if (falta) return error(`${falta}. Corrígelo antes de emitir.`, 422);
    } else {
      const missing = [];
      if (!c?.fiscalName && !c?.name) missing.push("razón social");
      if (!nifDeCliente(c)) missing.push("NIF/CIF");
      if (missing.length > 0) {
        return error(
          `El cliente no tiene datos fiscales completos: falta ${missing.join(" y ")}. Edita la ficha del cliente antes de emitir.`,
          422
        );
      }
    }

    // Si el borrador se emite sin dueDate, aplicar el plazo por defecto del
    // tenant (defaultPaymentTermsDays). Permite que un draft creado con
    // settings antiguos cuadre al emitir.
    let dueDateAtIssue = invoice.dueDate;
    if (!dueDateAtIssue) {
      const settings = await TenantBillingSettings.findOne();
      const termsDays = settings ? Number(settings.defaultPaymentTermsDays ?? 30) : 30;
      if (Number.isFinite(termsDays) && termsDays > 0) {
        const due = new Date(invoice.issueDate);
        due.setDate(due.getDate() + termsDays);
        dueDateAtIssue = due.toISOString().slice(0, 10);
      }
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
      const updates = { number: num, status: "issued" };
      if (dueDateAtIssue && !invoice.dueDate) updates.dueDate = dueDateAtIssue;
      /*
       * LA FOTO FISCAL, aquí y en ningún otro sitio (26/08/2026).
       *
       * Este es el único momento en que se sabe a quién se le está emitiendo:
       * cuatro líneas más arriba se acaba de exigir que la ficha tenga razón
       * social y NIF, y a partir de este `update` la factura ya no es un
       * borrador que se pueda rehacer. Congelarla en cualquier otro punto sería
       * congelar un dato que todavía podía cambiar.
       */
      updates.fiscalSnapshot = tutor ? fotoFiscalDeTutor(tutor, c) : fotoFiscalDe(c);
      await invoice.update(updates, { transaction: t });

      // El stock YA NO se descuenta aquí: se mueve en Pedidos (rework
      // 02/08/2026). Esto solo avisa si la factura lleva productos del almacén
      // sin venir de un pedido, para que nadie descubra el desvío meses después.
      // Se usa tenantHasModule (no hasModule) porque es un gate sobre el tenant,
      // no sobre el moduleAccess de quien emite la factura.
      if (tenantHasModule("inventory")) {
        inventoryWarnings.push(...(await applyStockMovementsForInvoice({ invoice })));
      }
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
    const payload = withEffectiveStatus(invoice);
    if (inventoryWarnings.length > 0) {
      return ok({ ...payload.toJSON?.() ?? payload, inventoryWarnings });
    }
    return ok(payload);
  } catch (err) {
    // Emisión con fecha fuera de orden: mensaje accionable (no un 500 genérico).
    if (err?.code === "OUT_OF_ORDER_DATE") return error(err.message, 422);
    return serverError(err);
  }
});

async function auditLog(data) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create(data);
  } catch {}
}
