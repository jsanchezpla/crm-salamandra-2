import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, noContent, forbidden, notFound } from "../../../../lib/utils/apiResponse.js";
import { computeStatus } from "../../../../lib/inventory/compute.js";

export const GET = withTenant(async (_request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { InventoryProduct, Client } = tenantModels;
  const { id } = await params;

  const product = await InventoryProduct.findByPk(id, {
    include: [{ model: Client, as: "client", attributes: ["id", "name", "customFields"] }],
  });
  if (!product) return notFound("Producto no encontrado");

  return ok(product);
});

export const PUT = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { InventoryProduct } = tenantModels;
  const { id } = await params;
  const body = await request.json();

  const product = await InventoryProduct.findByPk(id);
  if (!product) return notFound("Producto no encontrado");

  const kg = body.kg !== undefined ? body.kg : product.kg;
  const outputKg = body.outputKg !== undefined ? body.outputKg : product.outputKg;
  const status = computeStatus(kg, outputKg);

  await product.update({
    supplier: "supplier" in body ? (body.supplier?.trim() || null) : product.supplier,
    entryDate: "entryDate" in body ? (body.entryDate || null) : product.entryDate,
    productName: body.productName?.trim() || product.productName,
    units: "units" in body ? (body.units ? parseInt(body.units) : null) : product.units,
    kg: "kg" in body ? (body.kg ? parseFloat(body.kg) : null) : product.kg,
    packaging: "packaging" in body ? (body.packaging?.trim() || null) : product.packaging,
    lot: "lot" in body ? (body.lot?.trim() || null) : product.lot,
    purchasePrice: "purchasePrice" in body ? (body.purchasePrice ? parseFloat(body.purchasePrice) : null) : product.purchasePrice,
    outputName: "outputName" in body ? (body.outputName?.trim() || null) : product.outputName,
    clientId: "clientId" in body ? (body.clientId || null) : product.clientId,
    exitDate: "exitDate" in body ? (body.exitDate || null) : product.exitDate,
    outputKg: "outputKg" in body ? (body.outputKg ? parseFloat(body.outputKg) : null) : product.outputKg,
    salePrice: "salePrice" in body ? (body.salePrice ? parseFloat(body.salePrice) : null) : product.salePrice,
    notes: "notes" in body ? (body.notes?.trim() || null) : product.notes,
    status,
  });

  return ok(product);
});

export const DELETE = withTenant(async (_request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { InventoryProduct } = tenantModels;
  const { id } = await params;

  const product = await InventoryProduct.findByPk(id);
  if (!product) return notFound("Producto no encontrado");

  await product.destroy();
  return noContent();
});
