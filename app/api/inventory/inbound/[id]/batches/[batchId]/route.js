import { withTenant } from "../../../../../../../lib/tenant/withTenant.js";
import { ok, noContent, forbidden, notFound, error } from "../../../../../../../lib/utils/apiResponse.js";

export const PUT = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { InboundBatch } = tenantModels;
  const { id, batchId } = await params;
  const body = await request.json();

  const batch = await InboundBatch.findByPk(batchId);
  if (!batch || batch.inboundProductId !== id) return notFound("Lote no encontrado");

  const newKg = "kg" in body ? Number(body.kg) : Number(batch.kg);
  const newKgRem = "kgRemaining" in body ? Number(body.kgRemaining) : Number(batch.kgRemaining);
  if (newKgRem > newKg) return error("kgRemaining no puede ser mayor que kg", 422);

  await batch.update({
    supplier: body.supplier?.trim() || batch.supplier,
    lot: "lot" in body ? (body.lot?.trim() || null) : batch.lot,
    entryDate: "entryDate" in body ? (body.entryDate || null) : batch.entryDate,
    kg: newKg,
    kgRemaining: newKgRem,
    packaging: "packaging" in body ? (body.packaging?.trim() || null) : batch.packaging,
    purchasePrice: "purchasePrice" in body ? (body.purchasePrice ? parseFloat(body.purchasePrice) : null) : batch.purchasePrice,
    notes: "notes" in body ? (body.notes?.trim() || null) : batch.notes,
  });

  return ok(batch);
});

export const DELETE = withTenant(async (_request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { InboundBatch, StockMovement } = tenantModels;
  const { id, batchId } = await params;

  const batch = await InboundBatch.findByPk(batchId);
  if (!batch || batch.inboundProductId !== id) return notFound("Lote no encontrado");

  const movementCount = await StockMovement.count({ where: { inboundBatchId: batchId } });
  if (movementCount > 0) {
    return error("No se puede eliminar: tiene movimientos de stock asociados.", 409);
  }

  await batch.destroy();
  return noContent();
});
