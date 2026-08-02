import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, forbidden, notFound, error } from "../../../../lib/utils/apiResponse.js";
import { moverStock, stockDe } from "../../../../lib/inventory/stock.js";
import { resolveCurrentTeamMemberId } from "../../../../lib/team/currentTeamMember.js";
import { auditar, datosPeticion } from "../../../../lib/utils/auditoria.js";
import { Op } from "sequelize";

/**
 * Movimientos de stock — el libro mayor del almacén (rework 02/08/2026).
 *
 * GET lista el histórico de un producto. POST solo sirve para **ajustes
 * manuales**: las entradas se registran en `/api/inventory/entries` y las
 * salidas por venta las genera Pedidos al completarse. Dejar que cualquiera
 * escriba un movimiento de tipo «entrada» por aquí permitiría inflar el stock
 * sin dejar constancia de qué entrega lo justifica.
 */
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { StockMovement, Product, TeamMember } = tenantModels;
  const { searchParams } = new URL(request.url);

  const where = {};
  if (searchParams.get("productId")) where.productId = searchParams.get("productId");
  if (searchParams.get("type")) where.type = searchParams.get("type");
  const desde = searchParams.get("desde");
  const hasta = searchParams.get("hasta");
  if (desde || hasta) {
    where.movedAt = {};
    if (desde) where.movedAt[Op.gte] = desde;
    if (hasta) where.movedAt[Op.lte] = hasta;
  }

  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "100"), 500);

  const { rows, count } = await StockMovement.findAndCountAll({
    where,
    order: [["movedAt", "DESC"]],
    limit,
    offset: (page - 1) * limit,
    include: [
      { model: Product, as: "product", attributes: ["id", "name", "unit"] },
      { model: TeamMember, as: "teamMember", attributes: ["id", "name"] },
    ],
  });

  return ok({ movements: rows, total: count, page, pages: Math.ceil(count / limit) });
});

/** Ajuste manual. Ver cabecera: solo ajustes. */
export const POST = withTenant(async (request, _ctx, { tenant, tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { Product } = tenantModels;
  const body = await request.json();

  if (!body.productId) return error("Falta el producto", 422);
  const cantidad = Number(body.quantity);
  if (!Number.isFinite(cantidad) || cantidad === 0) {
    return error("La cantidad del ajuste no puede ser cero", 422);
  }
  // Obligatorio a propósito: un «faltan 12» sin explicación no vale de nada
  // dentro de seis meses, que es justo cuando alguien lo va a mirar.
  if (!body.reason?.trim()) {
    return error("Explica el motivo del ajuste (rotura, caducado, recuento…)", 422);
  }

  const product = await Product.findByPk(body.productId);
  if (!product) return notFound("Producto no encontrado");

  // Un ajuste no puede dejar el stock en negativo: sería un almacén imposible y
  // encima silencioso. Si de verdad falta más de lo que hay, el dato malo es
  // otro y hay que mirarlo, no taparlo con otro ajuste.
  const actual = await stockDe(tenantModels, body.productId);
  if (actual + cantidad < 0) {
    return error(
      `El ajuste dejaría el stock en negativo: hay ${actual} ${product.unit} y quitas ${Math.abs(cantidad)}`,
      422
    );
  }

  const teamMemberId = await resolveCurrentTeamMemberId(request, tenantModels);
  const mov = await moverStock(tenantModels, {
    productId: body.productId,
    quantity: cantidad,
    type: "ajuste",
    reason: body.reason.trim().slice(0, 255),
    teamMemberId,
  });

  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "inventory.stock.adjusted",
    entity: "StockMovement",
    entityId: mov.id,
    after: { productId: body.productId, quantity: cantidad, reason: mov.reason, stockDespues: actual + cantidad },
  });

  return created({ ...mov.toJSON(), stockDespues: actual + cantidad });
});
