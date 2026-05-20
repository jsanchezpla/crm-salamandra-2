import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, forbidden, error } from "../../../../lib/utils/apiResponse.js";
import { Op } from "sequelize";

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { InboundProduct, InboundBatch } = tenantModels;
  const { searchParams } = new URL(request.url);

  const search = searchParams.get("search");
  const tag = searchParams.get("tag");
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "100"), 500);
  const offset = (page - 1) * limit;

  const where = {};
  if (search) where.name = { [Op.iLike]: `%${search}%` };
  if (tag) where.tags = { [Op.contains]: [tag] };

  const { rows, count } = await InboundProduct.findAndCountAll({
    where,
    limit,
    offset,
    order: [["name", "ASC"]],
    include: [
      {
        model: InboundBatch,
        as: "batches",
        attributes: ["id", "supplier", "lot", "entryDate", "kg", "kgRemaining", "packaging", "purchasePrice"],
      },
    ],
  });

  const enriched = rows.map((p) => {
    const j = p.toJSON();
    const stockKg = (j.batches || []).reduce((sum, b) => sum + Number(b.kgRemaining || 0), 0);
    const suppliers = [...new Set((j.batches || []).map((b) => b.supplier).filter(Boolean))];
    return { ...j, stockKg: +stockKg.toFixed(3), suppliers };
  });

  return ok({ products: enriched, total: count, page, pages: Math.ceil(count / limit) });
});

export const POST = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { InboundProduct, InboundBatch } = tenantModels;
  const body = await request.json();

  if (!body.name?.trim()) return error("El nombre es obligatorio", 422);

  const product = await InboundProduct.create({
    name: body.name.trim(),
    tags: Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean) : [],
    notes: body.notes?.trim() || null,
  });

  // Si la petición incluye un primer batch, lo creamos también
  if (body.firstBatch && (body.firstBatch.supplier || Number(body.firstBatch.kg) > 0)) {
    const b = body.firstBatch;
    const kgIn = Number(b.kg) || 0;
    await InboundBatch.create({
      inboundProductId: product.id,
      supplier: (b.supplier?.trim()) || "(sin proveedor)",
      lot: b.lot?.trim() || null,
      entryDate: b.entryDate || null,
      kg: kgIn,
      kgRemaining: kgIn,
      packaging: b.packaging?.trim() || null,
      purchasePrice: b.purchasePrice ? parseFloat(b.purchasePrice) : null,
      notes: b.notes?.trim() || null,
    });
  }

  return created(product);
});
