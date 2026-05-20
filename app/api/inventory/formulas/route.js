import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, forbidden, error } from "../../../../lib/utils/apiResponse.js";

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { Formula, InboundProduct, OutboundProduct, Client } = tenantModels;
  const { searchParams } = new URL(request.url);

  const where = {};
  const outboundProductId = searchParams.get("outboundProductId");
  const inboundProductId = searchParams.get("inboundProductId");
  const clientId = searchParams.get("clientId");
  if (outboundProductId) where.outboundProductId = outboundProductId;
  if (inboundProductId) where.inboundProductId = inboundProductId;
  if (clientId) where.clientId = clientId === "null" ? null : clientId;

  const formulas = await Formula.findAll({
    where,
    order: [["createdAt", "ASC"]],
    include: [
      { model: InboundProduct, as: "inboundProduct", attributes: ["id", "name"] },
      { model: OutboundProduct, as: "outboundProduct", attributes: ["id", "name"] },
      { model: Client, as: "client", attributes: ["id", "name"] },
    ],
  });
  return ok(formulas);
});

export const POST = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { Formula } = tenantModels;
  const body = await request.json();

  if (!body.outboundProductId) return error("outboundProductId es obligatorio", 422);
  if (!body.inboundProductId) return error("inboundProductId es obligatorio", 422);
  const qty = Number(body.qtyKgPerOutputKg);
  if (!isFinite(qty) || qty <= 0) return error("qtyKgPerOutputKg debe ser mayor que 0", 422);

  try {
    const formula = await Formula.create({
      outboundProductId: body.outboundProductId,
      inboundProductId: body.inboundProductId,
      qtyKgPerOutputKg: qty,
      clientId: body.clientId || null,
      notes: body.notes?.trim() || null,
    });
    return created(formula);
  } catch (err) {
    if (err.name === "SequelizeUniqueConstraintError" || err.original?.code === "23505") {
      return error("Ya existe una receta para esta combinación (producto saliente, entrante, cliente).", 409);
    }
    throw err;
  }
});
