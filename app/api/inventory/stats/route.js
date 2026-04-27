import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden } from "../../../../lib/utils/apiResponse.js";

export const GET = withTenant(async (_request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { InventoryProduct, Client } = tenantModels;

  const products = await InventoryProduct.findAll({
    include: [{ model: Client, as: "client", attributes: ["id", "name", "customFields"] }],
  });

  let totalKgStock = 0;
  let totalKgSold = 0;
  let totalRevenue = 0;
  let totalCost = 0;

  const clientMap = {};
  const productMap = {};

  for (const p of products) {
    const kg = parseFloat(p.kg || 0);
    const outputKg = parseFloat(p.outputKg || 0);
    const purchasePrice = parseFloat(p.purchasePrice || 0);
    const salePrice = parseFloat(p.salePrice || 0);

    if (p.status === "stock") totalKgStock += kg;
    if (p.status === "partial") totalKgStock += Math.max(0, kg - outputKg);

    if (outputKg > 0) {
      const revenue = salePrice * outputKg;
      const cost = purchasePrice * outputKg;
      totalKgSold += outputKg;
      totalRevenue += revenue;
      totalCost += cost;

      if (p.clientId) {
        const clientName = p.client?.customFields?.company || p.client?.name || "Desconocido";
        if (!clientMap[p.clientId]) {
          clientMap[p.clientId] = { clientName, kgPurchased: 0, revenue: 0 };
        }
        clientMap[p.clientId].kgPurchased += outputKg;
        clientMap[p.clientId].revenue += revenue;
      }

      const pName = p.outputName || p.productName;
      if (!productMap[pName]) {
        productMap[pName] = { productName: pName, kgSold: 0, revenue: 0 };
      }
      productMap[pName].kgSold += outputKg;
      productMap[pName].revenue += revenue;
    }
  }

  const totalMargin = totalRevenue - totalCost;
  const marginPercent = totalRevenue > 0 ? (totalMargin / totalRevenue) * 100 : 0;

  const topClients = Object.values(clientMap)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)
    .map((c) => ({ ...c, kgPurchased: +c.kgPurchased.toFixed(3), revenue: +c.revenue.toFixed(2) }));

  const topProducts = Object.values(productMap)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)
    .map((p) => ({ ...p, kgSold: +p.kgSold.toFixed(3), revenue: +p.revenue.toFixed(2) }));

  return ok({
    totalProducts: products.length,
    totalKgStock: +totalKgStock.toFixed(3),
    totalKgSold: +totalKgSold.toFixed(3),
    totalRevenue: +totalRevenue.toFixed(2),
    totalCost: +totalCost.toFixed(2),
    totalMargin: +totalMargin.toFixed(2),
    marginPercent: +marginPercent.toFixed(1),
    topClients,
    topProducts,
  });
});
