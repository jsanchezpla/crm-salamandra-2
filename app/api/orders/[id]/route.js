import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, noContent, forbidden, notFound, error, serverError } from "../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion, resumen } from "../../../../lib/utils/auditoria.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

function recalculateOrder(lines, transportAmount) {
  const subtotal = lines.reduce((acc, l) => acc + Number(l.lineTotal || 0), 0);
  const total = subtotal + Number(transportAmount || 0);
  return {
    subtotal: subtotal.toFixed(2),
    total: total.toFixed(2),
  };
}

export const GET = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  if (!hasModule("orders")) return forbidden("Módulo orders no activo");
  const { Order, OrderLine, Client, Invoice } = tenantModels;
  const { id } = await params;

  const order = await Order.findByPk(id, {
    include: [
      { model: OrderLine, as: "lines" },
      { model: Client, as: "client" },
      { model: Invoice, as: "invoice", attributes: ["id", "number", "status", "total", "issueDate"] },
    ],
  });
  if (!order) return notFound("Pedido no encontrado");
  return ok(order);
});

export const PATCH = withTenant(async (request, { params }, { tenant, tenantModels, hasModule, tenantSequelize }) => {
  if (!hasModule("orders")) return forbidden("Módulo orders no activo");
  const role = request.headers.get("x-user-role");
  if (!ADMIN_ROLES.has(role)) return forbidden("Solo administradores pueden modificar pedidos");

  const { Order, OrderLine } = tenantModels;
  const { id } = await params;
  const body = await request.json();

  const order = await Order.findByPk(id, { include: [{ model: OrderLine, as: "lines" }] });
  if (!order) return notFound("Pedido no encontrado");

  if (order.status === "completed") {
    return error("No se puede editar un pedido completado", 409);
  }

  try {
    await tenantSequelize.transaction(async (t) => {
      // Si vienen líneas en el body, sustituimos las existentes en bloque.
      if (Array.isArray(body.lines)) {
        await OrderLine.destroy({ where: { orderId: id }, transaction: t });
        const normalized = body.lines.map((l) => {
          const quantity = Number(l.quantity || 0);
          const unitPrice = Number(l.unitPrice || 0);
          return {
            orderId: id,
            outboundProductId: l.outboundProductId || null,
            productName: (l.productName || "").trim() || "(sin nombre)",
            quantity: quantity.toFixed(3),
            unitPrice: unitPrice.toFixed(2),
            lineTotal: (quantity * unitPrice).toFixed(2),
            notes: l.notes?.trim() || null,
          };
        });
        if (normalized.length > 0) {
          await OrderLine.bulkCreate(normalized, { transaction: t });
        }
        order.lines = normalized; // para el recálculo abajo
      }

      const transportAmount =
        body.transportAmount != null ? Number(body.transportAmount) : Number(order.transportAmount);
      const totals = recalculateOrder(order.lines || [], transportAmount);

      const patch = {
        transportAmount: transportAmount.toFixed(2),
        subtotal: totals.subtotal,
        total: totals.total,
      };
      if ("status" in body) patch.status = body.status;
      if ("clientId" in body && body.clientId) patch.clientId = body.clientId;
      if ("scheduledDate" in body) patch.scheduledDate = body.scheduledDate || null;
      if ("notes" in body) patch.notes = body.notes?.trim() || null;
      if ("customFields" in body) patch.customFields = body.customFields || {};

      await order.update(patch, { transaction: t });
    });

    // La auditoría va FUERA de la transacción y después de que confirme: se
    // escribe en master, con otra conexión, así que dentro habría dejado
    // rastro de un cambio que un rollback posterior deshiciera.
    await auditar({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "order.updated",
      entity: "Order",
      entityId: order.id,
      after: resumen(order, ["number", "status", "total"]),
    });

    const fresh = await Order.findByPk(id, {
      include: [{ model: OrderLine, as: "lines" }],
    });
    return ok(fresh);
  } catch (err) {
    if (err?.name?.startsWith("Sequelize")) {
      return error(`Datos inválidos: ${err.errors?.[0]?.message || err.message}`, 422);
    }
    return serverError(err);
  }
});

export const DELETE = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  if (!hasModule("orders")) return forbidden("Módulo orders no activo");
  const role = request.headers.get("x-user-role");
  if (!ADMIN_ROLES.has(role)) return forbidden("Solo administradores pueden borrar pedidos");

  const { Order } = tenantModels;
  const { id } = await params;
  const order = await Order.findByPk(id);
  if (!order) return notFound("Pedido no encontrado");

  if (order.status === "completed" && order.invoiceId) {
    return error(
      "No se puede borrar un pedido completado que ya generó factura. Cancela primero la factura asociada.",
      409
    );
  }

  const antesBorrar = resumen(order, ["number", "status", "total"]);
  const idBorrado = order.id;
  await order.destroy();
  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "order.deleted",
    entity: "Order",
    entityId: idBorrado,
    before: antesBorrar,
  });
  return noContent();
});
