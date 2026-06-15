import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, forbidden, notFound, noContent } from "../../../../../lib/utils/apiResponse.js";
import { ForbiddenError } from "../../../../../lib/utils/errors.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const ADMIN_DENY = "Solo administradores pueden modificar este recurso";

/**
 * GET /api/training/users/[id]
 *
 * Devuelve el empleado individual con su empresa. NO filtra por archivedAt:
 * útil para que la UI muestre el detalle de un archivado al hacer click en
 * el listado con ?includeArchived.
 */
export const GET = withTenant(async (_request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("training")) throw new ForbiddenError();

  const { TrainingUser, Company } = tenantModels;
  const { id } = await params;

  const user = await TrainingUser.findByPk(id, {
    include: [{ model: Company, as: "company", attributes: ["id", "name"] }],
  });
  if (!user) return notFound("Empleado no encontrado");
  return ok(user);
});

/**
 * DELETE /api/training/users/[id]
 *
 * Soft delete: marca `archivedAt = NOW()`. Conserva la fila, matrículas y
 * cuestionarios para preservar el historial. Si el empleado ya estaba
 * archivado, devuelve 200 con `noop:true` (idempotente).
 *
 * Para reactivar usar POST /api/training/users/[id]/restore o re-importar
 * el Excel con su email — `/users/import` reactiva automáticamente los
 * archivados.
 */
export const DELETE = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("training")) throw new ForbiddenError();
  const role = request.headers.get("x-user-role");
  if (!ADMIN_ROLES.has(role)) return forbidden(ADMIN_DENY);

  const { TrainingUser } = tenantModels;
  const { id } = await params;

  const user = await TrainingUser.findByPk(id);
  if (!user) return notFound("Empleado no encontrado");

  if (user.archivedAt) {
    console.log(`[training:archive] noop email=${user.email} (ya archivado el ${user.archivedAt.toISOString?.() ?? user.archivedAt})`);
    return ok({ noop: true, archivedAt: user.archivedAt });
  }

  await user.update({ archivedAt: new Date() });
  console.log(`[training:archive] archived email=${user.email} id=${user.id}`);
  return noContent();
});
