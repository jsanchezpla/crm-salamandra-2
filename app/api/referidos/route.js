import { withTenant } from "../../../lib/tenant/withTenant.js";
import { ok, forbidden } from "../../../lib/utils/apiResponse.js";
import { Op } from "sequelize";

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("leads") && !hasModule("sales")) return forbidden();

  const { Lead } = tenantModels;
  const { searchParams } = new URL(request.url);

  const stage = searchParams.get("stage");
  const search = searchParams.get("search");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "100"), 200);
  const offset = parseInt(searchParams.get("offset") ?? "0");

  // Siempre filtramos por source = referido_abarcaia
  const where = {
    customFields: { [Op.contains]: { source: "referido_abarcaia" } },
  };

  if (stage) where.stage = stage;

  if (search) {
    where[Op.and] = [
      { customFields: { [Op.contains]: { source: "referido_abarcaia" } } },
      {
        [Op.or]: [
          { name: { [Op.iLike]: `%${search}%` } },
          { email: { [Op.iLike]: `%${search}%` } },
          { phone: { [Op.iLike]: `%${search}%` } },
        ],
      },
    ];
    delete where.customFields;
  }

  const { rows, count } = await Lead.findAndCountAll({
    where,
    limit,
    offset,
    order: [["createdAt", "DESC"]],
  });

  return ok({ referidos: rows, total: count });
});
