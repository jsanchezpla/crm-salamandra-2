import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, forbidden, notFound, error } from "../../../../lib/utils/apiResponse.js";
import { Op } from "sequelize";

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { StockMovement, InboundBatch, InboundProduct, OutboundProduct, Client } = tenantModels;
  const { searchParams } = new URL(request.url);

  const where = {};
  const inboundBatchId = searchParams.get("inboundBatchId");
  const outboundProductId = searchParams.get("outboundProductId");
  const clientId = searchParams.get("clientId");
  const reason = searchParams.get("reason");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  if (inboundBatchId) where.inboundBatchId = inboundBatchId;
  if (outboundProductId) where.outboundProductId = outboundProductId;
  if (clientId) where.clientId = clientId;
  if (reason) where.reason = reason;
  if (dateFrom || dateTo) {
    where.movedAt = {};
    if (dateFrom) where.movedAt[Op.gte] = dateFrom;
    if (dateTo) where.movedAt[Op.lte] = dateTo;
  }

  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "100"), 500);
  const offset = (page - 1) * limit;

  const { rows, count } = await StockMovement.findAndCountAll({
    where,
    limit,
    offset,
    order: [["movedAt", "DESC"]],
    include: [
      {
        model: InboundBatch,
        as: "batch",
        attributes: ["id", "supplier", "lot"],
        include: [{ model: InboundProduct, as: "product", attributes: ["id", "name"] }],
      },
      { model: OutboundProduct, as: "outboundProduct", attributes: ["id", "name"] },
      { model: Client, as: "client", attributes: ["id", "name"] },
    ],
  });

  return ok({ movements: rows, total: count, page, pages: Math.ceil(count / limit) });
});

export const POST = withTenant(async (request, _ctx, { tenantModels, tenantSequelize, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { StockMovement, InboundBatch } = tenantModels;
  const body = await request.json();

  if (!body.inboundBatchId) return error("inboundBatchId es obligatorio", 422);
  const kg = Number(body.kg);
  if (!isFinite(kg) || kg === 0) return error("kg debe ser distinto de 0", 422);

  const batch = await InboundBatch.findByPk(body.inboundBatchId);
  if (!batch) return notFound("Lote no encontrado");

  const newRemaining = Number(batch.kgRemaining) + kg;
  if (newRemaining < 0) {
    return error(`Stock insuficiente: el lote tiene ${batch.kgRemaining} kg disponibles`, 422);
  }

  // Transacción: mover stock + crear movement
  const result = await tenantSequelize.transaction(async (t) => {
    await batch.update({ kgRemaining: newRemaining }, { transaction: t });
    return StockMovement.create(
      {
        inboundBatchId: body.inboundBatchId,
        kg,
        reason: body.reason || "manual",
        invoiceId: body.invoiceId || null,
        invoiceLineId: body.invoiceLineId || null,
        outboundProductId: body.outboundProductId || null,
        clientId: body.clientId || null,
        userId: null,
        movedAt: body.movedAt || new Date(),
        notes: body.notes?.trim() || null,
      },
      { transaction: t }
    );
  });

  return created(result);
});
