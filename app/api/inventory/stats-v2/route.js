import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden } from "../../../../lib/utils/apiResponse.js";

export const GET = withTenant(async (_request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { InboundProduct, InboundBatch, OutboundProduct, StockMovement, Client } = tenantModels;

  // ── Inbound: stock total y por producto ───────────────────────────────
  const inboundProducts = await InboundProduct.findAll({
    include: [{ model: InboundBatch, as: "batches", attributes: ["kg", "kgRemaining", "purchasePrice"] }],
  });

  let totalKgStock = 0;
  let totalKgPurchased = 0;
  let totalPurchaseValue = 0;
  const stockByProduct = inboundProducts.map((p) => {
    const j = p.toJSON();
    const stockKg = (j.batches || []).reduce((s, b) => s + Number(b.kgRemaining || 0), 0);
    const purchasedKg = (j.batches || []).reduce((s, b) => s + Number(b.kg || 0), 0);
    const purchaseValue = (j.batches || []).reduce(
      (s, b) => s + Number(b.kg || 0) * Number(b.purchasePrice || 0),
      0
    );
    totalKgStock += stockKg;
    totalKgPurchased += purchasedKg;
    totalPurchaseValue += purchaseValue;
    return {
      id: j.id,
      name: j.name,
      stockKg: +stockKg.toFixed(3),
      purchasedKg: +purchasedKg.toFixed(3),
    };
  });

  // ── Outbound: kg vendidos e ingresos ──────────────────────────────────
  const salesMovements = await StockMovement.findAll({
    where: { reason: ["sale", "historical"] },
    include: [
      { model: OutboundProduct, as: "outboundProduct", attributes: ["id", "name", "defaultSalePrice"] },
      { model: Client, as: "client", attributes: ["id", "name"] },
    ],
  });

  let totalKgSold = 0;
  let totalRevenue = 0;
  const byClient = {};
  const byProduct = {};

  for (const m of salesMovements) {
    const kgOut = Math.abs(Number(m.kg));
    const price = Number(m.outboundProduct?.defaultSalePrice || 0);
    const revenue = kgOut * price;
    totalKgSold += kgOut;
    totalRevenue += revenue;

    if (m.clientId) {
      const key = m.clientId;
      const name = m.client?.name || "Desconocido";
      if (!byClient[key]) byClient[key] = { clientId: key, clientName: name, kg: 0, revenue: 0 };
      byClient[key].kg += kgOut;
      byClient[key].revenue += revenue;
    }
    if (m.outboundProductId) {
      const key = m.outboundProductId;
      const name = m.outboundProduct?.name || "Desconocido";
      if (!byProduct[key]) byProduct[key] = { outboundProductId: key, name, kg: 0, revenue: 0 };
      byProduct[key].kg += kgOut;
      byProduct[key].revenue += revenue;
    }
  }

  const topClients = Object.values(byClient)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)
    .map((c) => ({ ...c, kg: +c.kg.toFixed(3), revenue: +c.revenue.toFixed(2) }));
  const topProducts = Object.values(byProduct)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)
    .map((p) => ({ ...p, kg: +p.kg.toFixed(3), revenue: +p.revenue.toFixed(2) }));

  const totalCost = inboundProducts.reduce((s, p) => {
    const j = p.toJSON();
    return s + (j.batches || []).reduce((bs, b) => bs + (Number(b.kg) - Number(b.kgRemaining)) * Number(b.purchasePrice || 0), 0);
  }, 0);
  const totalMargin = totalRevenue - totalCost;
  const marginPercent = totalRevenue > 0 ? (totalMargin / totalRevenue) * 100 : 0;

  return ok({
    totalInboundProducts: inboundProducts.length,
    totalKgStock: +totalKgStock.toFixed(3),
    totalKgPurchased: +totalKgPurchased.toFixed(3),
    totalPurchaseValue: +totalPurchaseValue.toFixed(2),
    totalKgSold: +totalKgSold.toFixed(3),
    totalRevenue: +totalRevenue.toFixed(2),
    totalCost: +totalCost.toFixed(2),
    totalMargin: +totalMargin.toFixed(2),
    marginPercent: +marginPercent.toFixed(1),
    stockByProduct,
    topClients,
    topProducts,
  });
});
