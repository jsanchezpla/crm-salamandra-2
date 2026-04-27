import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { forbidden } from "../../../../lib/utils/apiResponse.js";
import { Op } from "sequelize";
import ExcelJS from "exceljs";

const STATUS_LABELS = { stock: "En stock", sold: "Vendido", partial: "Parcial" };

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { InventoryProduct, Client } = tenantModels;
  const { searchParams } = new URL(request.url);

  const where = {};
  const status = searchParams.get("status");
  const clientId = searchParams.get("clientId");
  const search = searchParams.get("search");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

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
    ];
  }

  const products = await InventoryProduct.findAll({
    where,
    order: [["entryDate", "DESC"], ["createdAt", "DESC"]],
    include: [{ model: Client, as: "client", attributes: ["name", "customFields"] }],
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CRM Salamandra";
  const sheet = workbook.addWorksheet("Inventario");

  sheet.columns = [
    { header: "Proveedor", key: "supplier", width: 22 },
    { header: "Fecha entrada", key: "entryDate", width: 14 },
    { header: "Producto", key: "productName", width: 28 },
    { header: "Lote", key: "lot", width: 14 },
    { header: "Unidades", key: "units", width: 10 },
    { header: "Kg entrada", key: "kg", width: 12 },
    { header: "Embalaje", key: "packaging", width: 16 },
    { header: "Precio compra €/kg", key: "purchasePrice", width: 18 },
    { header: "Producto salida", key: "outputName", width: 28 },
    { header: "Cliente", key: "clientName", width: 22 },
    { header: "Fecha salida", key: "exitDate", width: 14 },
    { header: "Kg salida", key: "outputKg", width: 12 },
    { header: "Precio venta €/kg", key: "salePrice", width: 18 },
    { header: "Margen €", key: "margin", width: 12 },
    { header: "Estado", key: "status", width: 12 },
    { header: "Notas", key: "notes", width: 30 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0047AB" } };
  headerRow.alignment = { vertical: "middle", horizontal: "left" };
  headerRow.height = 22;

  for (const p of products) {
    const outputKg = parseFloat(p.outputKg || 0);
    const margin = outputKg > 0
      ? +((parseFloat(p.salePrice || 0) - parseFloat(p.purchasePrice || 0)) * outputKg).toFixed(2)
      : "";

    sheet.addRow({
      supplier: p.supplier || "",
      entryDate: p.entryDate || "",
      productName: p.productName || "",
      lot: p.lot || "",
      units: p.units ?? "",
      kg: p.kg ? parseFloat(p.kg) : "",
      packaging: p.packaging || "",
      purchasePrice: p.purchasePrice ? parseFloat(p.purchasePrice) : "",
      outputName: p.outputName || "",
      clientName: p.client?.customFields?.company || p.client?.name || "",
      exitDate: p.exitDate || "",
      outputKg: p.outputKg ? parseFloat(p.outputKg) : "",
      salePrice: p.salePrice ? parseFloat(p.salePrice) : "",
      margin,
      status: STATUS_LABELS[p.status] ?? p.status,
      notes: p.notes || "",
    });
  }

  for (let i = 2; i <= products.length + 1; i++) {
    const row = sheet.getRow(i);
    row.height = 18;
    if (i % 2 === 0) {
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } };
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const fecha = new Date().toISOString().slice(0, 10);

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="inventario_${fecha}.xlsx"`,
    },
  });
});
