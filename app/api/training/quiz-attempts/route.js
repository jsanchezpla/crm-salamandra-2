import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../lib/utils/apiResponse.js";
import { ForbiddenError } from "../../../../lib/utils/errors.js";
import { Op } from "sequelize";
import { filtroPorNombre } from "../../../../lib/utils/busquedaDb.js";

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("training")) throw new ForbiddenError();

  const { QuizAttempt } = tenantModels;
  const { searchParams } = new URL(request.url);

  const where = {};
  const search = searchParams.get("search");
  // Acepta ambos nombres: `companyName` (canónico desde sprint Retorika
  // Bloque 3) y `empresa` (legacy, mantiene compatibilidad). El primero
  // que llegue gana.
  const companyName = searchParams.get("companyName") ?? searchParams.get("empresa");
  const result = searchParams.get("result");
  const wpCourseId = searchParams.get("courseId");
  const wpQuizId = searchParams.get("quizId");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 500);
  const offset = parseInt(searchParams.get("offset") ?? "0");

  if (companyName) where.empresa = { [Op.iLike]: `%${companyName}%` };
  if (result) where.result = result;
  if (wpCourseId) where.wpCourseId = parseInt(wpCourseId);
  if (wpQuizId) where.wpQuizId = parseInt(wpQuizId);
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
