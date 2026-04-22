import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../../lib/utils/apiResponse.js";
import { ForbiddenError, NotFoundError } from "../../../../../lib/utils/errors.js";

export const GET = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("training")) throw new ForbiddenError();

  const { QuizAttempt } = tenantModels;
  const { id } = await params;

  const attempt = await QuizAttempt.findByPk(id);
  if (!attempt) throw new NotFoundError("Intento no encontrado");

  return ok(attempt);
});
