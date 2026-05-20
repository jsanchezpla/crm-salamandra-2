import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, forbidden, error } from "../../../../lib/utils/apiResponse.js";
import { Op } from "sequelize";

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { OutboundProduct, Formula, InboundProduct, Client, ClientOutboundAlias } = tenantModels;
  const { searchParams } = new URL(request.url);

  const search = searchParams.get("search");
  const tag = searchParams.get("tag");
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "100"), 500);
  const offset = (page - 1) * limit;

  const where = {};
  if (search) where.name = { [Op.iLike]: `%${search}%` };
  if (tag) where.tags = { [Op.contains]: [tag] };

  const { rows, count } = await OutboundProduct.findAndCountAll({
    where,
    limit,
    offset,
    order: [["name", "ASC"]],
    include: [
      {
        model: Formula,
        as: "components",
        include: [{ model: InboundProduct, as: "inboundProduct", attributes: ["id", "name"] }, { model: Client, as: "client", attributes: ["id", "name"] }],
      },
      {
        model: ClientOutboundAlias,
        as: "aliases",
        include: [{ model: Client, as: "client", attributes: ["id", "name"] }],
      },
    ],
  });

  return ok({ products: rows, total: count, page, pages: Math.ceil(count / limit) });
});

export const POST = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { OutboundProduct } = tenantModels;
  const body = await request.json();

  if (!body.name?.trim()) return error("El nombre es obligatorio", 422);

  const product = await OutboundProduct.create({
    name: body.name.trim(),
    tags: Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean) : [],
    defaultSalePrice: body.defaultSalePrice ? parseFloat(body.defaultSalePrice) : null,
    notes: body.notes?.trim() || null,
  });

  return created(product);
});
