import { withTenant } from "../../../lib/tenant/withTenant.js";
import { ok, forbidden } from "../../../lib/utils/apiResponse.js";
import { Op } from "sequelize";

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("training") && !hasModule("cuestionarios")) return forbidden();

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
