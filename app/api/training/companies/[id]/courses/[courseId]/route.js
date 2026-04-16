import { withTenant } from "../../../../../../../lib/tenant/withTenant.js";
import { noContent } from "../../../../../../../lib/utils/apiResponse.js";
import { NotFoundError, ForbiddenError } from "../../../../../../../lib/utils/errors.js";

export const DELETE = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("training")) throw new ForbiddenError();

  const { CompanyCourse } = tenantModels;
  const { id, courseId } = await params;

  const relation = await CompanyCourse.findOne({
    where: { companyId: id, courseId },
  });

  if (!relation) throw new NotFoundError("Relación empresa-curso no encontrada");

  await relation.destroy();
  return noContent();
});
