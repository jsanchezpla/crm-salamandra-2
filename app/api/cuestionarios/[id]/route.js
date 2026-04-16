import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, notFound } from "../../../../lib/utils/apiResponse.js";

export const GET = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("training") && !hasModule("cuestionarios")) return forbidden();

  const { QuizAttempt } = tenantModels;
  const { id } = await params;

  const attempt = await QuizAttempt.findByPk(id);
  if (!attempt) return notFound("Intento no encontrado");

  return ok(attempt);
});
