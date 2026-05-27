import { Op } from "sequelize";
import { withTenant } from "../../../lib/tenant/withTenant.js";
import { ok, created, forbidden, error, serverError } from "../../../lib/utils/apiResponse.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

function recalculateOrder(lines, transportAmount) {
  const subtotal = lines.reduce((acc, l) => acc + Number(l.lineTotal || 0), 0);
  const total = subtotal + Number(transportAmount || 0);
  return {
    subtotal: subtotal.toFixed(2),
    total: total.toFixed(2),
  };
}

// GET /api/orders — lista paginada con filtros básicos
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("orders")) return forbidden("Módulo orders no activo");

  const { Order, Client, OrderLine } = tenantModels;
  const { searchParams } = new URL(request.url);

  const status = searchParams.get("status");
  const clientId = searchParams.get("clientId");
  const search = (searchParams.get("search") || "").trim();
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
  const offset = (page - 1) * limit;

  const where = {};
  if (status) where.status = status;
  if (clientId) where.clientId = clientId;
  const include = [
    { model: Client, as: "client", attributes: ["id", "name", "email", "customFields"], required: false },
    { model: OrderLine, as: "lines" },
  ];
  if (search) {
    include[0].where = { name: { [Op.iLike]: `%${search}%` } };
    include[0].required = true;
  }

  const { rows, count } = await Order.findAndCountAll({
    where,
    include,
    limit,
    offset,
    order: [["createdAt", "DESC"]],
    distinct: true,
  });

  return ok({ orders: rows, total: count, page, pages: Math.ceil(count / limit) });
});

// POST /api/orders — crea pedido en estado draft
export const POST = withTenant(async (request, _ctx, { tenantModels, hasModule, tenantSequelize }) => {
  if (!hasModule("orders")) return forbidden("Módulo orders no activo");
  const role = request.headers.get("x-user-role");
  if (!ADMIN_ROLES.has(role)) return forbidden("Solo administradores pueden crear pedidos");

  const { Order, OrderLine, OrderSettings } = tenantModels;
  const body = await request.json();

  const clientId = body.clientId;
  if (!clientId) return error("clientId es obligatorio", 422);

  const settings = await OrderSettings.findOne();
  const defaultTransport = settings ? Number(settings.transportPrice) : 0;
  const transportAmount =
    body.transportAmount != null ? Number(body.transportAmount) : defaultTransport;

  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  const normalizedLines = rawLines.map((l) => {
    const quantity = Number(l.quantity || 0);
    const unitPrice = Number(l.unitPrice || 0);
    return {
      outboundProductId: l.outboundProductId || null,
      productName: (l.productName || "").trim() || "(sin nombre)",
      quantity: quantity.toFixed(3),
      unitPrice: unitPrice.toFixed(2),
      lineTotal: (quantity * unitPrice).toFixed(2),
      notes: l.notes?.trim() || null,
    };
  });

  const totals = recalculateOrder(normalizedLines, transportAmount);

  try {
    const result = await tenantSequelize.transaction(async (t) => {
      const order = await Order.create(
        {
          clientId,
          status: body.status || "draft",
          transportAmount: Number(transportAmount).toFixed(2),
          subtotal: totals.subtotal,
          total: totals.total,
          scheduledDate: body.scheduledDate || null,
          notes: body.notes?.trim() || null,
          customFields: body.customFields || {},
        },
        { transaction: t }
      );

      if (normalizedLines.length > 0) {
        await OrderLine.bulkCreate(
          normalizedLines.map((l) => ({ ...l, orderId: order.id })),
          { transaction: t }
        );
      }
      return order;
    });

    const fresh = await Order.findByPk(result.id, {
      include: [{ model: OrderLine, as: "lines" }],
    });
    return created(fresh);
  } catch (err) {
    if (err?.name?.startsWith("Sequelize")) {
      return error(`Datos inválidos: ${err.errors?.[0]?.message || err.message}`, 422);
    }
    return serverError(err);
  }
});
