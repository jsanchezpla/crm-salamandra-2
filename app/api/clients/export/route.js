import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { forbidden } from "../../../../lib/utils/apiResponse.js";
import { Op } from "sequelize";
import ExcelJS from "exceljs";

const STATUS_LABELS = {
  new: "Nuevo",
  contacted: "Contactado",
  following: "En seguimiento",
  converted: "Convertido",
  discarded: "Descartado",
};

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("clients")) return forbidden();

  const { Client } = tenantModels;
  const { searchParams } = new URL(request.url);

  const where = {};
  const status = searchParams.get("status");
  const country = searchParams.get("country");
  const search = searchParams.get("search");

  if (status) where.customFields = { [Op.contains]: { seStatus: status } };
  if (country && !status) where.customFields = { [Op.contains]: { country } };
  if (country && status) where.customFields = { [Op.contains]: { seStatus: status, country } };
  if (search) {
    where[Op.or] = [
      { name: { [Op.iLike]: `%${search}%` } },
      { email: { [Op.iLike]: `%${search}%` } },
    ];
  }

  const clients = await Client.findAll({ where, order: [["createdAt", "DESC"]] });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CRM Salamandra";
  const sheet = workbook.addWorksheet("Clientes");

  sheet.columns = [
    { header: "Nombre", key: "name", width: 25 },
    { header: "Empresa", key: "company", width: 28 },
    { header: "Email", key: "email", width: 30 },
    { header: "Teléfono", key: "phone", width: 15 },
    { header: "País", key: "country", width: 18 },
    { header: "Ciudad", key: "city", width: 18 },
    { header: "Estado", key: "status", width: 18 },
    { header: "Notas", key: "notes", width: 40 },
    { header: "Origen", key: "origin", width: 12 },
    { header: "Fecha creación", key: "createdAt", width: 14 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0047AB" } };
  headerRow.alignment = { vertical: "middle", horizontal: "left" };
  headerRow.height = 22;

  for (const c of clients) {
    sheet.addRow({
      name: c.name || "",
      company: c.customFields?.company || "",
      email: c.email || "",
      phone: c.phone || "",
      country: c.customFields?.country || "",
      city: c.customFields?.city || "",
      status: STATUS_LABELS[c.customFields?.seStatus] ?? c.customFields?.seStatus ?? "",
      notes: c.notes || "",
      origin: c.customFields?.origin || "",
      createdAt: c.createdAt ? new Date(c.createdAt).toLocaleDateString("es-ES") : "",
    });
  }

  for (let i = 2; i <= clients.length + 1; i++) {
    const row = sheet.getRow(i);
    row.height = 18;
    row.eachCell((cell) => {
      cell.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };
    });
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
      "Content-Disposition": `attachment; filename="clientes_${fecha}.xlsx"`,
    },
  });
});
