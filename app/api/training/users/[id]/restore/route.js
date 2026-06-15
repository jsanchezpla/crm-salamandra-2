import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, forbidden, notFound } from "../../../../../../lib/utils/apiResponse.js";
import { ForbiddenError } from "../../../../../../lib/utils/errors.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const ADMIN_DENY = "Solo administradores pueden modificar este recurso";

/**
 * POST /api/training/users/[id]/restore
 *
 * Restaura un empleado previamente archivado (set archivedAt = NULL). NO
 * toca `active` ni `type`: si el empleado estaba inactivo cuando se archivó,
 * sigue inactivo tras restaurar y el flujo `/register/empresa` puede
 * activarlo normalmente.
 *
 * Idempotente: si el empleado no estaba archivado, devuelve 200 con
 * noop:true.
 */
export const POST = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("training")) throw new ForbiddenError();
  const role = request.headers.get("x-user-role");
  if (!ADMIN_ROLES.has(role)) return forbidden(ADMIN_DENY);

  const { TrainingUser } = tenantModels;
  const { id } = await params;

  const user = await TrainingUser.findByPk(id);
  if (!user) return notFound("Empleado no encontrado");

  if (!user.archivedAt) {
    console.log(`[training:restore] noop email=${user.email} (no estaba archivado)`);
    return ok({ noop: true, user });
  }

  await user.update({ archivedAt: null });
  console.log(`[training:restore] restored email=${user.email} id=${user.id}`);
  return ok(user);
});
