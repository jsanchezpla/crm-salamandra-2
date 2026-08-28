import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../lib/utils/apiResponse.js";
import { ForbiddenError } from "../../../../lib/utils/errors.js";
import { Op } from "sequelize";
import { filtroPorNombre } from "../../../../lib/utils/busqueda.js";

export const GET = withTenant(async (request, _ctx, { tenantModels, tenantSequelize, hasModule }) => {
  if (!hasModule("training")) throw new ForbiddenError();

  const { CourseEnrollment, TrainingUser, Course, Company } = tenantModels;
  const { searchParams } = new URL(request.url);

  const courseId = searchParams.get("courseId");
  const companyId = searchParams.get("companyId");
  const search = searchParams.get("search");
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 200);
  const offset = (page - 1) * limit;

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

  const { rows, count } = await CourseEnrollment.findAndCountAll({
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
        attributes: ["id", "name", "lastName", "email", "username", "nif", "country", "type"],
        include: [{ model: Company, as: "company", attributes: ["id", "name"] }],
      },
      {
        model: Course,
        as: "course",
        attributes: ["id", "name", "wpCourseId", "wcProductId"],
      },
    ],
    limit,
    offset,
    order: [["enrolledAt", "DESC"]],
  });

  return ok({ enrollments: rows, total: count, page, limit });
});
