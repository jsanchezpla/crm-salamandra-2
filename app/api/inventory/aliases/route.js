import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, forbidden, error } from "../../../../lib/utils/apiResponse.js";

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { ClientOutboundAlias, OutboundProduct, Client } = tenantModels;
  const { searchParams } = new URL(request.url);

  const where = {};
  const outboundProductId = searchParams.get("outboundProductId");
  const clientId = searchParams.get("clientId");
  if (outboundProductId) where.outboundProductId = outboundProductId;
  if (clientId) where.clientId = clientId;

  const aliases = await ClientOutboundAlias.findAll({
    where,
    order: [["aliasName", "ASC"]],
    include: [
      { model: OutboundProduct, as: "outboundProduct", attributes: ["id", "name"] },
      { model: Client, as: "client", attributes: ["id", "name"] },
    ],
  });
  return ok(aliases);
});

export const POST = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { ClientOutboundAlias } = tenantModels;
  const body = await request.json();

  if (!body.outboundProductId) return error("outboundProductId es obligatorio", 422);
  if (!body.clientId) return error("clientId es obligatorio", 422);
  if (!body.aliasName?.trim()) return error("aliasName es obligatorio", 422);

  try {
    const alias = await ClientOutboundAlias.create({
      outboundProductId: body.outboundProductId,
      clientId: body.clientId,
      aliasName: body.aliasName.trim(),
      customSalePrice: body.customSalePrice ? parseFloat(body.customSalePrice) : null,
    });
    return created(alias);
  } catch (err) {
    if (err.name === "SequelizeUniqueConstraintError" || err.original?.code === "23505") {
      return error("Ya existe un alias para este producto y cliente.", 409);
    }
    throw err;
  }
});
