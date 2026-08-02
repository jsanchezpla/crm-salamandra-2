import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, forbidden, error, notFound } from "../../../../lib/utils/apiResponse.js";
import { moverStock } from "../../../../lib/inventory/stock.js";
import { resolveCurrentTeamMemberId } from "../../../../lib/team/currentTeamMember.js";
import { auditar, datosPeticion, resumen } from "../../../../lib/utils/auditoria.js";
import { Op } from "sequelize";

/**
 * Entradas de mercancía: lo que llega del proveedor.
 *
 * Registrar una entrada **crea también su movimiento de stock**, en la misma
 * transacción. Son la misma cosa vista de dos maneras: si se pudieran separar,
 * antes o después habría una entrega registrada que no suma stock, y a partir de
 * ahí el almacén miente.
 */
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { StockEntry, Product, Supplier } = tenantModels;
  const { searchParams } = new URL(request.url);

  const where = {};
  if (searchParams.get("productId")) where.productId = searchParams.get("productId");
  if (searchParams.get("supplierId")) where.supplierId = searchParams.get("supplierId");
  const desde = searchParams.get("desde");
  const hasta = searchParams.get("hasta");
  if (desde && hasta) where.entryDate = { [Op.between]: [desde, hasta] };
  else if (desde) where.entryDate = { [Op.gte]: desde };
  else if (hasta) where.entryDate = { [Op.lte]: hasta };

  const entries = await StockEntry.findAll({
    where,
    order: [["entryDate", "DESC"]],
    limit: Math.min(parseInt(searchParams.get("limit") ?? "200"), 500),
    include: [
      { model: Product, as: "product", attributes: ["id", "name", "unit"] },
      { model: Supplier, as: "supplier", attributes: ["id", "name"] },
    ],
  });

  return ok({ entries, total: entries.length });
});

export const POST = withTenant(async (request, _ctx, { tenant, tenantModels, hasModule, tenantSequelize }) => {
  if (!hasModule("inventory")) return forbidden();

  const { StockEntry, Product } = tenantModels;
  const body = await request.json();

  if (!body.productId) return error("Falta el producto", 422);
  const cantidad = Number(body.quantity);
  if (!Number.isFinite(cantidad) || cantidad <= 0) {
    // Una entrada negativa sería una salida disfrazada: para eso está el ajuste,
    // que obliga a explicar el motivo.
    return error("La cantidad recibida tiene que ser mayor que cero", 422);
  }
  if (!body.entryDate) return error("Falta la fecha de la entrega", 422);

  const product = await Product.findByPk(body.productId);
  if (!product) return notFound("Producto no encontrado");

  const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
  const teamMemberId = await resolveCurrentTeamMemberId(request, tenantModels);

  const entry = await tenantSequelize.transaction(async (t) => {
    const fila = await StockEntry.create(
      {
        productId: body.productId,
        supplierId: body.supplierId || null,
        entryDate: body.entryDate,
        quantity: cantidad,
        unitCost: num(body.unitCost),
        lot: body.lot?.trim() || null,
        expiryDate: body.expiryDate || null,
        costId: body.costId || null,
        notes: body.notes?.trim() || null,
      },
      { transaction: t }
    );

    await moverStock(
      tenantModels,
      {
        productId: body.productId,
        quantity: cantidad,
        type: "entrada",
        reason: body.lot ? `Entrada · lote ${body.lot}` : "Entrada de mercancía",
        entryId: fila.id,
        teamMemberId,
        movedAt: new Date(`${body.entryDate}T12:00:00`),
      },
      t
    );

    return fila;
  });

  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "inventory.entry.created",
    entity: "StockEntry",
    entityId: entry.id,
    after: resumen(entry, ["productId", "quantity", "unitCost", "entryDate"]),
  });

  return created(entry);
});
