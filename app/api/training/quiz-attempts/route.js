import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../lib/utils/apiResponse.js";
import { ForbiddenError } from "../../../../lib/utils/errors.js";
import { Op } from "sequelize";

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
  if (search) {
    where[Op.or] = [
      { studentName: { [Op.iLike]: `%${search}%` } },
      { studentEmail: { [Op.iLike]: `%${search}%` } },
      { quizTitle: { [Op.iLike]: `%${search}%` } },
      { courseTitle: { [Op.iLike]: `%${search}%` } },
    ];
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
