import { withTenant } from "../../../lib/tenant/withTenant.js";
import { ok, forbidden } from "../../../lib/utils/apiResponse.js";
import { Op } from "sequelize";
import { filtroPorNombre } from "../../../lib/utils/busquedaDb.js";

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("training")) return forbidden();

  const { QuizAttempt } = tenantModels;
  const { searchParams } = new URL(request.url);

  const where = {};
  const search = searchParams.get("search");
  const empresa = searchParams.get("empresa");
  const result = searchParams.get("result");
  const wpCourseId = searchParams.get("courseId");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "100"), 500);
  const offset = parseInt(searchParams.get("offset") ?? "0");

  if (empresa) where.empresa = { [Op.iLike]: `%${empresa}%` };
  if (result) where.result = result;
  if (wpCourseId) where.wpCourseId = parseInt(wpCourseId);
  /*
   * Todas las palabras, cada una en cualquiera de los campos (28/08/2026): antes
   * «garcia ana» no encontraba a «Ana García», ni «garcia» sin tilde. Los
   * nombres de alumno llegan de TutorLMS tal y como los escribió cada persona,
   * con sus tildes. Ver `lib/utils/busqueda.js`.
   */
  if (search) {
    const porNombre = await filtroPorNombre(QuizAttempt.sequelize, search, [
      "QuizAttempt.student_name", "QuizAttempt.student_email",
      "QuizAttempt.quiz_title", "QuizAttempt.course_title",
    ]);
    if (porNombre) (where[Op.and] ||= []).push(porNombre);
  }

  const { rows, count } = await QuizAttempt.findAndCountAll({
    where,
    limit,
    offset,
    order: [["attemptDate", "DESC"]],
    attributes: { exclude: ["answers"] },
  });

  return ok({ attempts: rows, total: count });
});
