import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { error } from "../../../../../lib/utils/apiResponse.js";
import { ForbiddenError } from "../../../../../lib/utils/errors.js";
import { Op } from "sequelize";
import { filtroPorNombre } from "../../../../../lib/utils/busquedaDb.js";
import ExcelJS from "exceljs";

export const GET = withTenant(async (request, _ctx, { tenantModels, tenantSequelize, hasModule }) => {
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
  /*
   * Todas las palabras, cada una en cualquiera de los campos (28/08/2026), y
   * ahora también en el APELLIDO: no estaba en la lista, así que buscar por
   * apellido en Matrículas no encontraba a nadie ni escribiéndolo solo —
   * mientras la tabla de abajo sí lo pinta. Ver `lib/utils/busqueda.js`.
   *
   * Las columnas van con el alias de la asociación (`trainingUser`), no con el
   * del modelo: el filtro viaja dentro del include y con `TrainingUser.name`
   * Postgres contesta «falta una entrada para la tabla en la cláusula FROM».
   */
  if (search) {
    const porNombre = await filtroPorNombre(tenantSequelize, search, [
      "trainingUser.name", "trainingUser.last_name", "trainingUser.email", "trainingUser.username",
    ]);
    if (porNombre) (userWhere[Op.and] ||= []).push(porNombre);
  }

  const enrollments = await CourseEnrollment.findAll({
    where,
    include: [
      {
        model: TrainingUser,
        as: "trainingUser",
        // Reflect.ownKeys y no Object.keys (28/08/2026): las claves de
        // Sequelize (Op.and, Op.or) son SYMBOLS, y Object.keys no ve los
        // symbols. Como el filtro del buscador es justo un Op.*, esto daba
        // siempre 0 y el where se quedaba en undefined: el buscador de
        // Matrículas no ha filtrado NUNCA nada, escribieras lo que escribieras.
        where: Reflect.ownKeys(userWhere).length ? userWhere : undefined,
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
