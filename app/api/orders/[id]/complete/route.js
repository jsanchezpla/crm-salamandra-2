import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, forbidden, notFound, error, serverError } from "../../../../../lib/utils/apiResponse.js";
import { calculateInvoice } from "../../../../../lib/billing/calculateInvoice.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * POST /api/orders/[id]/complete
 *
 * Marca el pedido como `completed` y genera una factura en estado
 * `draft` con las líneas del pedido + una línea de transporte. La
 * factura queda visible en Facturación → Cobros. NO se emite
 * automáticamente (sin número correlativo, sin descuento de stock,
 * sin envío a Verifactu). La emisión y el descuento FIFO de stock
 * ocurren cuando Laura pulsa "Emitir" desde Facturación.
 */
export const POST = withTenant(async (request, { params }, { tenantModels, hasModule, tenantSequelize }) => {
  if (!hasModule("orders")) return forbidden("Módulo orders no activo");
  if (!hasModule("billing")) return forbidden("Módulo billing no activo (necesario para autofactura)");
  const role = request.headers.get("x-user-role");
  if (!ADMIN_ROLES.has(role)) return forbidden("Solo administradores pueden completar pedidos");

  const { Order, OrderLine, OrderSettings, Invoice, TenantBillingSettings } = tenantModels;
  const { id } = await params;

  const order = await Order.findByPk(id, { include: [{ model: OrderLine, as: "lines" }] });
  if (!order) return notFound("Pedido no encontrado");
  if (order.status === "completed") return error("El pedido ya está completado", 409);
  if (order.status === "cancelled") return error("No se puede completar un pedido cancelado", 409);
  if (!order.lines || order.lines.length === 0) {
    return error("El pedido no tiene líneas. Añade al menos una antes de completar.", 422);
  }

  const orderSettings = await OrderSettings.findOne();
  const billingSettings = TenantBillingSettings ? await TenantBillingSettings.findOne() : null;
  const defaultVat = orderSettings
    ? Number(orderSettings.defaultVatRate)
    : billingSettings
      ? Number(billingSettings.defaultVatRate)
      : 21;
  const transportVat = orderSettings ? Number(orderSettings.transportVatRate) : defaultVat;
  const termsDays =
    billingSettings && Number.isFinite(Number(billingSettings.defaultPaymentTermsDays))
      ? Number(billingSettings.defaultPaymentTermsDays)
      : 30;

  // Construir líneas de factura desde las del pedido
  const invoiceLines = order.lines.map((l) => ({
    description: l.productName,
    quantity: Number(l.quantity),
    unitPrice: Number(l.unitPrice),
    vatRate: defaultVat,
    outboundProductId: l.outboundProductId || null,
  }));

  // Línea de transporte (kind: "shipping") si hay importe
  const transportAmount = Number(order.transportAmount || 0);
  if (transportAmount > 0) {
    invoiceLines.push({
      description: "Transporte",
      quantity: 1,
      unitPrice: transportAmount,
      vatRate: transportVat,
      kind: "shipping",
    });
  }

  const issueDate = new Date().toISOString().slice(0, 10);
  const dueDate = (() => {
    const due = new Date(issueDate);
    due.setDate(due.getDate() + termsDays);
    return due.toISOString().slice(0, 10);
  })();

  const calc = calculateInvoice({ lines: invoiceLines });

  try {
    const result = await tenantSequelize.transaction(async (t) => {
      // Factura en borrador. Número placeholder DRAFT-* idéntico al patrón
      // de POST /api/billing/invoices. La emisión real reasigna número.
      const invoice = await Invoice.create(
        {
          clientId: order.clientId,
          issueDate,
          dueDate,
          lines: calc.lines,
          taxBase: calc.taxBase,
          vatAmount: calc.vatAmount,
          total: calc.total,
          paidAmount: 0,
          series: "F",
          number: `DRAFT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          status: "draft",
          notes: `Pedido #${order.id.slice(0, 8)} — generada automáticamente al completar.`,
          customFields: { sourceOrderId: order.id },
          subtotal: calc.taxBase,
          vatRate: 0,
        },
        { transaction: t }
      );

      await order.update(
        {
          status: "completed",
          deliveredAt: new Date(),
          invoiceId: invoice.id,
        },
        { transaction: t }
      );

      return { order, invoice };
    });

    const freshOrder = await Order.findByPk(result.order.id, {
      include: [
        { model: OrderLine, as: "lines" },
        { model: Invoice, as: "invoice", attributes: ["id", "number", "status", "total"] },
      ],
    });
    return ok({ order: freshOrder, invoiceId: result.invoice.id });
  } catch (err) {
    if (err?.name?.startsWith("Sequelize")) {
      return error(`Error generando la factura: ${err.errors?.[0]?.message || err.message}`, 422);
    }
    return serverError(err);
  }
});
