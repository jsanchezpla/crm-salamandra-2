import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, forbidden, notFound, error, serverError } from "../../../../../lib/utils/apiResponse.js";
import { calculateInvoice } from "../../../../../lib/billing/calculateInvoice.js";
import { moverStock, stockDeVarios } from "../../../../../lib/inventory/stock.js";
import { resolveCurrentTeamMemberId } from "../../../../../lib/team/currentTeamMember.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * POST /api/orders/[id]/complete
 *
 * Marca el pedido como `completed`, **descuenta el stock** y genera una factura
 * en estado `draft` con las líneas del pedido + una línea de transporte. La
 * factura queda visible en Facturación → Cobros. NO se emite automáticamente
 * (sin número correlativo, sin envío a Verifactu): eso ocurre al pulsar "Emitir".
 *
 * ── El descuento de stock (arreglado el 02/08/2026) ─────────────────────────
 *
 * Hasta hoy este endpoint NO tocaba el almacén, y estaba escrito como pendiente
 * en este mismo comentario. Se podían vender 500 libros teniendo 3 y el
 * inventario ni se enteraba: el fallo más grave del módulo.
 *
 * Ahora, dentro de la MISMA transacción que marca el pedido como completado:
 *
 *   · Se comprueba que hay stock suficiente de cada línea ANTES de tocar nada.
 *     Si falta de algo, no se completa el pedido y se dice de qué falta y
 *     cuánto hay. Completar a medias sería peor que no completar.
 *   · Se genera un movimiento negativo por línea, de tipo `pedido`.
 *
 * Las líneas SIN producto del almacén (`productId` nulo) no descuentan nada: son
 * conceptos sueltos escritos a mano, y en Aumenta además son la mayoría.
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
    productId: l.productId || null,
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

  // ── Comprobación de stock ANTES de abrir la transacción ────────────────────
  // Se acumula por producto: dos líneas del mismo producto tienen que sumar, o
  // un pedido con 2 líneas de 3 unidades pasaría teniendo 4 en el almacén.
  const conProducto = (order.lines ?? []).filter((l) => l.productId);
  let faltantes = [];
  if (conProducto.length && hasModule("inventory")) {
    const pedidoPorProducto = {};
    for (const l of conProducto) {
      pedidoPorProducto[l.productId] = (pedidoPorProducto[l.productId] ?? 0) + Number(l.quantity || 0);
    }
    const ids = Object.keys(pedidoPorProducto);
    const stocks = await stockDeVarios(tenantModels, ids);
    const { Product } = tenantModels;
    const productos = await Product.findAll({ where: { id: ids }, attributes: ["id", "name", "unit"] });
    const porId = Object.fromEntries(productos.map((p) => [p.id, p]));
    faltantes = ids
      .filter((id) => (stocks[id] ?? 0) < pedidoPorProducto[id])
      .map((id) => ({
        producto: porId[id]?.name ?? "(producto retirado)",
        unidad: porId[id]?.unit ?? "ud",
        piden: pedidoPorProducto[id],
        hay: stocks[id] ?? 0,
      }));
  }
  if (faltantes.length) {
    const detalle = faltantes
      .map((f) => `${f.producto}: piden ${f.piden} ${f.unidad} y hay ${f.hay}`)
      .join(" · ");
    return error(`No hay stock suficiente. ${detalle}`, 409, { faltantes });
  }

  const teamMemberId = await resolveCurrentTeamMemberId(request, tenantModels);

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

      // Salidas de almacén, en la MISMA transacción: o se completa el pedido y
      // se descuenta, o no pasa ninguna de las dos cosas.
      if (hasModule("inventory")) {
        for (const l of conProducto) {
          await moverStock(
            tenantModels,
            {
              productId: l.productId,
              quantity: -Math.abs(Number(l.quantity || 0)),
              type: "pedido",
              reason: `Pedido #${order.id.slice(0, 8)}`,
              orderId: order.id,
              teamMemberId,
            },
            t
          );
        }
      }

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
