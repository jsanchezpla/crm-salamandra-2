import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, created, forbidden, notFound, error } from "../../../../../../lib/utils/apiResponse.js";

export const GET = withTenant(async (_request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { InboundProduct, InboundBatch } = tenantModels;
  const { id } = await params;

  const product = await InboundProduct.findByPk(id);
  if (!product) return notFound("Producto entrante no encontrado");

  const batches = await InboundBatch.findAll({
    where: { inboundProductId: id },
    order: [["entryDate", "ASC"]],
  });
  return ok(batches);
});

export const POST = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { InboundProduct, InboundBatch } = tenantModels;
  const { id } = await params;
  const body = await request.json();

  const product = await InboundProduct.findByPk(id);
  if (!product) return notFound("Producto entrante no encontrado");

  if (!body.supplier?.trim()) return error("El proveedor es obligatorio", 422);
  const kgIn = Number(body.kg) || 0;
  if (kgIn < 0) return error("Los kg deben ser >= 0", 422);

  const batch = await InboundBatch.create({
    inboundProductId: id,
    supplier: body.supplier.trim(),
    lot: body.lot?.trim() || null,
    entryDate: body.entryDate || null,
    kg: kgIn,
    kgRemaining: kgIn,
    packaging: body.packaging?.trim() || null,
    purchasePrice: body.purchasePrice ? parseFloat(body.purchasePrice) : null,
    notes: body.notes?.trim() || null,
  });

  return created(batch);
});
