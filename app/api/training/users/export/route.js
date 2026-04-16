import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ForbiddenError } from "../../../../../lib/utils/errors.js";
import { Op } from "sequelize";
import ExcelJS from "exceljs";

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("training")) throw new ForbiddenError();

  const { TrainingUser, Company } = tenantModels;
  const { searchParams } = new URL(request.url);

  const type = searchParams.get("type");
  const companyId = searchParams.get("companyId");
  const search = searchParams.get("search");

  const where = {};
  if (type) where.type = type;
  if (companyId) where.companyId = companyId;
  if (search) {
    const q = `%${search}%`;
    where[Op.or] = [
      { name: { [Op.iLike]: q } },
      { lastName: { [Op.iLike]: q } },
      { email: { [Op.iLike]: q } },
      { username: { [Op.iLike]: q } },
    ];
  }

  const users = await TrainingUser.findAll({
    where,
    include: [{ model: Company, as: "company", attributes: ["id", "name"] }],
    order: [["name", "ASC"]],
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Usuarios");

  sheet.columns = [
    { header: "ID", key: "id", width: 38 },
    { header: "Nombre", key: "name", width: 20 },
    { header: "Apellidos", key: "lastName", width: 20 },
    { header: "Email", key: "email", width: 30 },
    { header: "Username", key: "username", width: 20 },
    { header: "Tipo", key: "type", width: 12 },
    { header: "Empresa", key: "company", width: 25 },
    { header: "NIF", key: "nif", width: 15 },
    { header: "País", key: "country", width: 15 },
    { header: "Fecha nacimiento", key: "birthDate", width: 18 },
    { header: "Activo", key: "active", width: 10 },
  ];

  sheet.getRow(1).font = { bold: true };

  for (const u of users) {
    sheet.addRow({
      id: u.id,
      name: u.name ?? "",
      lastName: u.lastName ?? "",
      email: u.email,
      username: u.username ?? "",
      type: u.type === "company" ? "Empresa" : "Privado",
      company: u.company?.name ?? "",
      nif: u.nif ?? "",
      country: u.country ?? "",
      birthDate: u.birthDate ? new Date(u.birthDate).toLocaleDateString("es-ES") : "",
      active: u.active ? "Sí" : "No",
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const date = new Date().toISOString().slice(0, 10);

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="usuarios-${date}.xlsx"`,
    },
  });
});
