import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { logBillingAudit, resumenImporte, datosPeticion } from "../../../../../lib/billing/audit.js";
import { ok, noContent, error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { updateInvoiceStatus } from "../../../../../lib/billing/updateInvoiceStatus.js";

const VALID_STATUS = new Set(["pending", "completed", "failed", "refunded"]);

export const GET = withTenant(async (_request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Payment, Invoice } = tenantModels;
    const { id } = await params;
    const payment = await Payment.findByPk(id, {
      include: [{ model: Invoice, as: "invoice" }],
    });
    if (!payment) return notFound("Cobro no encontrado");
    return ok(payment);
  } catch (err) {
    return serverError(err);
  }
});

export const PATCH = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");

    const { Payment, Invoice } = tenantModels;
    const { id } = await params;
    const body = await request.json();
    const payment = await Payment.findByPk(id);
    if (!payment) return notFound("Cobro no encontrado");

    const allowed = ["status", "notes", "method", "amount", "paidAt"];
    const updates = {};
    for (const k of allowed) {
      if (k in body) updates[k] = body[k];
    }
    if (updates.status && !VALID_STATUS.has(updates.status)) {
      return error("status inválido");
    }
    if (updates.amount != null && Number(updates.amount) <= 0) {
      return error("amount debe ser mayor que 0");
    }

    // Asociar (o desasociar) el cobro a una factura (31/08/2026): el flujo real
    // es cobrar ANTES de facturar, y hasta hoy un cobro suelto no tenía forma
    // de engancharse a la factura emitida después — la factura se quedaba
    // «emitida» con el dinero ya cobrado. Mismas garantías que el POST:
    // factura viva, mismo cliente y sin exceder el pendiente. El
    // `period_month` NO se toca: morosidad y portal siguen leyendo lo mismo.
    const facturaAnteriorId = payment.invoiceId;
    if ("invoiceId" in body) {
      if (body.invoiceId) {
        const destino = await Invoice.findByPk(body.invoiceId);
        if (!destino) return notFound("Factura no encontrada");
        if (["draft", "cancelled", "rectified"].includes(destino.status)) {
          return error(`No se puede asociar un cobro a una factura en estado '${destino.status}'`, 409);
        }
        if (payment.clientId && destino.clientId && String(payment.clientId) !== String(destino.clientId)) {
          return error("El cobro es de un cliente distinto al de la factura", 409);
        }
        const importeFinal = updates.amount != null ? Number(updates.amount) : Number(payment.amount);
        const pendiente = Number(destino.total) - Number(destino.paidAmount);
        if (String(facturaAnteriorId ?? "") !== String(destino.id) && importeFinal > pendiente + 0.0049) {
          return error(`El importe (${importeFinal}) excede el pendiente de la factura (${pendiente.toFixed(2)})`, 400);
        }
        updates.invoiceId = destino.id;
        if (!payment.clientId) updates.clientId = destino.clientId;
      } else {
        // Desasociar deja el cobro suelto: sin cliente quedaría huérfano.
        if (!payment.clientId) return error("No se puede desasociar: el cobro se quedaría sin cliente", 409);
        updates.invoiceId = null;
      }
    }

    // Cambiar el importe de un cobro ya enganchado tampoco puede pasarse del
    // pendiente de su factura (revisión del 06/09/2026): 100 € → 150 € dejaba
    // `paidAmount` por encima del total y «Cobrado 150 €» en el PDF.
    if (updates.amount != null && !("invoiceId" in body) && payment.invoiceId) {
      const suya = await Invoice.findByPk(payment.invoiceId);
      if (suya) {
        const pendienteSinEste = Number(suya.total) - Number(suya.paidAmount) + Number(payment.amount);
        if (Number(updates.amount) > pendienteSinEste + 0.0049) {
          return error(`El importe (${Number(updates.amount)}) excede el pendiente de la factura (${pendienteSinEste.toFixed(2)})`, 400);
        }
      }
    }

    const antes = resumenImporte(payment);
    await payment.update(updates);
    await logBillingAudit({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "payment.updated",
      entity: "Payment",
      entityId: payment.id,
      before: antes,
      after: resumenImporte(payment),
    });

    // Se recalculan las DOS facturas tocadas: a la que llega el cobro y de la
    // que se va (si cambió). Si no, la antigua se quedaría contando un dinero
    // que ya no es suyo.
    const tocadas = new Set([payment.invoiceId, facturaAnteriorId].filter(Boolean).map(String));
    for (const invId of tocadas) {
      const invoice = await Invoice.findByPk(invId);
      if (invoice) await updateInvoiceStatus(invoice, Payment);
    }

    return ok(payment);
  } catch (err) {
    return serverError(err);
  }
});

export const DELETE = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");

    const { Payment, Invoice } = tenantModels;
    const { id } = await params;
    const payment = await Payment.findByPk(id);
    if (!payment) return notFound("Cobro no encontrado");

    const invoiceId = payment.invoiceId;
    // Borrar un cobro cambia lo que el cliente debe: tiene que quedar rastro.
    const antesBorrar = resumenImporte(payment);
    const idPago = payment.id;
    await payment.destroy();
    await logBillingAudit({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "payment.deleted",
      entity: "Payment",
      entityId: idPago,
      before: antesBorrar,
      after: null,
    });
    const invoice = await Invoice.findByPk(invoiceId);
    if (invoice) await updateInvoiceStatus(invoice, Payment);
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
