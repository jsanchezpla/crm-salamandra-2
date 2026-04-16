import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { error } from "../../../../../lib/utils/apiResponse.js";
import { ForbiddenError } from "../../../../../lib/utils/errors.js";
import { Op } from "sequelize";
import ExcelJS from "exceljs";

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("training")) throw new ForbiddenError();

  const { CourseEnrollment, TrainingUser, Course, Company } = tenantModels;
  const { searchParams } = new URL(request.url);

  const courseId = searchParams.get("courseId");
  const companyId = searchParams.get("companyId");
  const search = searchParams.get("search");

  const where = {};
  if (courseId) where.courseId = courseId;
  if (companyId) where.companyId = companyId;

  const userWhere = {};
  if (search) {
    const q = `%${search}%`;
    userWhere[Op.or] = [
      { name: { [Op.iLike]: q } },
      { email: { [Op.iLike]: q } },
      { username: { [Op.iLike]: q } },
    ];
  }

  const enrollments = await CourseEnrollment.findAll({
    where,
    include: [
      {
        model: TrainingUser,
        as: "trainingUser",
        where: Object.keys(userWhere).length ? userWhere : undefined,
        include: [{ model: Company, as: "company", attributes: ["id", "name"] }],
      },
      { model: Course, as: "course" },
    ],
    order: [["enrolledAt", "DESC"]],
  });

  // ── Construir Excel ─────────────────────────────────────────────────────────
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Alumnos");

  sheet.columns = [
    { header: "ID Registro", key: "id", width: 38 },
    { header: "ID Usuario", key: "userId", width: 38 },
    { header: "Nombre", key: "name", width: 20 },
    { header: "Email", key: "email", width: 30 },
    { header: "Username", key: "username", width: 20 },
    { header: "Empresa", key: "company", width: 25 },
    { header: "Curso", key: "course", width: 35 },
    { header: "Fecha matrícula", key: "enrolledAt", width: 20 },
    { header: "NIF", key: "nif", width: 15 },
    { header: "País", key: "country", width: 15 },
  ];

  // Cabecera en negrita
  sheet.getRow(1).font = { bold: true };

  for (const e of enrollments) {
    const u = e.trainingUser;
    sheet.addRow({
      id: e.id,
      userId: u?.id ?? "",
      name: u ? `${u.name ?? ""} ${u.lastName ?? ""}`.trim() : "",
      email: u?.email ?? "",
      username: u?.username ?? "",
      company: u?.company?.name ?? "",
      course: e.course?.name ?? "",
      enrolledAt: e.enrolledAt ? new Date(e.enrolledAt).toLocaleDateString("es-ES") : "",
      nif: u?.nif ?? "",
      country: u?.country ?? "",
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const date = new Date().toISOString().slice(0, 10);

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="alumnos-${date}.xlsx"`,
    },
  });
});
