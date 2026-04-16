import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, forbidden } from "../../../../../lib/utils/apiResponse.js";
import { NotFoundError, ForbiddenError } from "../../../../../lib/utils/errors.js";

export const GET = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("training")) throw new ForbiddenError();

  const { Company, Course } = tenantModels;
  const { id } = await params;

  const company = await Company.findByPk(id, {
    include: [{ model: Course, as: "courses" }],
  });

  if (!company) throw new NotFoundError("Empresa no encontrada");

  return ok(company);
});
