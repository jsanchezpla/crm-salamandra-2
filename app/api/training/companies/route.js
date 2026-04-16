import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, forbidden } from "../../../../lib/utils/apiResponse.js";
import { ValidationError, ForbiddenError } from "../../../../lib/utils/errors.js";

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("training")) throw new ForbiddenError();

  const { Company, TrainingUser, CompanyCourse } = tenantModels;

  const companies = await Company.findAll({
    order: [["name", "ASC"]],
  });

  // Contar cursos y usuarios por empresa en paralelo
  const ids = companies.map((c) => c.id);

  const [courseCounts, userCounts] = await Promise.all([
    CompanyCourse.findAll({
      attributes: [
        "companyId",
        [CompanyCourse.sequelize.fn("COUNT", CompanyCourse.sequelize.col("id")), "count"],
      ],
      where: { companyId: ids },
      group: ["companyId"],
      raw: true,
    }),
    TrainingUser.findAll({
      attributes: [
        "companyId",
        [TrainingUser.sequelize.fn("COUNT", TrainingUser.sequelize.col("id")), "count"],
      ],
      where: { companyId: ids, active: true },
      group: ["companyId"],
      raw: true,
    }),
  ]);

  const courseCountMap = Object.fromEntries(courseCounts.map((r) => [r.companyId, parseInt(r.count)]));
  const userCountMap = Object.fromEntries(userCounts.map((r) => [r.companyId, parseInt(r.count)]));

  const data = companies.map((c) => ({
    ...c.toJSON(),
    courseCount: courseCountMap[c.id] ?? 0,
    userCount: userCountMap[c.id] ?? 0,
  }));

  return ok(data);
});

export const POST = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("training")) throw new ForbiddenError();

  const { Company } = tenantModels;
  const body = await request.json();
  const { name, externalId, active } = body;

  if (!name?.trim()) throw new ValidationError("El campo name es obligatorio");

  const company = await Company.create({
    name: name.trim(),
    externalId: externalId ?? null,
    active: active !== undefined ? active : true,
  });

  return created(company);
});
