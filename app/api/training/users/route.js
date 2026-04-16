import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../lib/utils/apiResponse.js";
import { ForbiddenError } from "../../../../lib/utils/errors.js";
import { Op } from "sequelize";

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("training")) throw new ForbiddenError();

  const { TrainingUser, Company } = tenantModels;
  const { searchParams } = new URL(request.url);

  const type = searchParams.get("type");
  const companyId = searchParams.get("companyId");
  const search = searchParams.get("search");
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 200);
  const offset = (page - 1) * limit;

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

  const { rows, count } = await TrainingUser.findAndCountAll({
    where,
    include: [{ model: Company, as: "company", attributes: ["id", "name"] }],
    limit,
    offset,
    order: [["name", "ASC"]],
  });

  return ok({ users: rows, total: count, page, limit });
});
