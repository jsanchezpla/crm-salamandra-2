import { withTenant } from "../../../../../../../lib/tenant/withTenant.js";
import { noContent, forbidden } from "../../../../../../../lib/utils/apiResponse.js";
import { NotFoundError, ForbiddenError } from "../../../../../../../lib/utils/errors.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const ADMIN_DENY = "Solo administradores pueden modificar este recurso";

export const DELETE = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("training")) throw new ForbiddenError();
  const role = request.headers.get("x-user-role");
  if (!ADMIN_ROLES.has(role)) return forbidden(ADMIN_DENY);

  const { CompanyCourse } = tenantModels;
  const { id, courseId } = await params;

  const relation = await CompanyCourse.findOne({
    where: { companyId: id, courseId },
  });

  if (!relation) throw new NotFoundError("Relación empresa-curso no encontrada");

  await relation.destroy();
  return noContent();
});
