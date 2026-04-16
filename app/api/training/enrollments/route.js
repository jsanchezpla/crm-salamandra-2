import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../lib/utils/apiResponse.js";
import { ForbiddenError } from "../../../../lib/utils/errors.js";
import { Op } from "sequelize";

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
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
  if (search) {
    const q = `%${search}%`;
    userWhere[Op.or] = [
      { name: { [Op.iLike]: q } },
      { email: { [Op.iLike]: q } },
      { username: { [Op.iLike]: q } },
    ];
  }

  const { rows, count } = await CourseEnrollment.findAndCountAll({
    where,
    include: [
      {
        model: TrainingUser,
        as: "trainingUser",
        where: Object.keys(userWhere).length ? userWhere : undefined,
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
