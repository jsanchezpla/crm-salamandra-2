import { withTenant } from "../../../lib/tenant/withTenant.js";
import { ok, created, forbidden, error } from "../../../lib/utils/apiResponse.js";
import { computeStatus } from "../../../lib/inventory/compute.js";
import { Op } from "sequelize";

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { InventoryProduct, Client } = tenantModels;
  const { searchParams } = new URL(request.url);

  const search = searchParams.get("search");
  const status = searchParams.get("status");
  const clientId = searchParams.get("clientId");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 200);
  const offset = (page - 1) * limit;

  const where = {};
  if (status) where.status = status;
  if (clientId) where.clientId = clientId;
  if (dateFrom || dateTo) {
    where.entryDate = {};
    if (dateFrom) where.entryDate[Op.gte] = dateFrom;
    if (dateTo) where.entryDate[Op.lte] = dateTo;
  }
  if (search) {
    where[Op.or] = [
      { productName: { [Op.iLike]: `%${search}%` } },
      { supplier: { [Op.iLike]: `%${search}%` } },
      { lot: { [Op.iLike]: `%${search}%` } },
      { outputName: { [Op.iLike]: `%${search}%` } },
    ];
  }

  const { rows, count } = await InventoryProduct.findAndCountAll({
    where,
    limit,
    offset,
    order: [["createdAt", "DESC"]],
    include: [{ model: Client, as: "client", attributes: ["id", "name", "customFields"] }],
  });

  return ok({ products: rows, total: count, page, pages: Math.ceil(count / limit) });
});

export const POST = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { InventoryProduct } = tenantModels;
  const body = await request.json();

  if (!body.productName?.trim()) return error("El nombre del producto es obligatorio", 422);

  const status = computeStatus(body.kg, body.outputKg);

  const product = await InventoryProduct.create({
    supplier: body.supplier?.trim() || null,
    entryDate: body.entryDate || null,
    productName: body.productName.trim(),
    units: body.units ? parseInt(body.units) : null,
    kg: body.kg ? parseFloat(body.kg) : null,
    packaging: body.packaging?.trim() || null,
    lot: body.lot?.trim() || null,
    purchasePrice: body.purchasePrice ? parseFloat(body.purchasePrice) : null,
    outputName: body.outputName?.trim() || null,
    clientId: body.clientId || null,
    exitDate: body.exitDate || null,
    outputKg: body.outputKg ? parseFloat(body.outputKg) : null,
    salePrice: body.salePrice ? parseFloat(body.salePrice) : null,
    status,
    notes: body.notes?.trim() || null,
  });

  return created(product);
});
