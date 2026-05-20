import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, noContent, forbidden, notFound, error } from "../../../../../lib/utils/apiResponse.js";

export const GET = withTenant(async (_request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { InboundProduct, InboundBatch, Formula, OutboundProduct, Client } = tenantModels;
  const { id } = await params;

  const product = await InboundProduct.findByPk(id, {
    include: [
      { model: InboundBatch, as: "batches", order: [["entryDate", "ASC"]] },
      {
        model: Formula,
        as: "formulaUses",
        include: [
          { model: OutboundProduct, as: "outboundProduct", attributes: ["id", "name"] },
          { model: Client, as: "client", attributes: ["id", "name"] },
        ],
      },
    ],
  });
  if (!product) return notFound("Producto entrante no encontrado");

  const j = product.toJSON();
  const stockKg = (j.batches || []).reduce((sum, b) => sum + Number(b.kgRemaining || 0), 0);
  return ok({ ...j, stockKg: +stockKg.toFixed(3) });
});

export const PUT = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { InboundProduct } = tenantModels;
  const { id } = await params;
  const body = await request.json();

  const product = await InboundProduct.findByPk(id);
  if (!product) return notFound("Producto entrante no encontrado");

  await product.update({
    name: body.name?.trim() || product.name,
    tags: Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean) : product.tags,
    notes: "notes" in body ? (body.notes?.trim() || null) : product.notes,
  });

  return ok(product);
});

export const DELETE = withTenant(async (_request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { InboundProduct, InboundBatch, Formula } = tenantModels;
  const { id } = await params;

  const product = await InboundProduct.findByPk(id);
  if (!product) return notFound("Producto entrante no encontrado");

  const batchCount = await InboundBatch.count({ where: { inboundProductId: id } });
  if (batchCount > 0) {
    return error("No se puede eliminar: tiene lotes asociados. Borra los lotes primero.", 409);
  }
  const formulaCount = await Formula.count({ where: { inboundProductId: id } });
  if (formulaCount > 0) {
    return error("No se puede eliminar: forma parte de recetas. Quita las recetas primero.", 409);
  }

  await product.destroy();
  return noContent();
});
