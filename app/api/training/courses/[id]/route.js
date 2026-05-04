import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, forbidden } from "../../../../../lib/utils/apiResponse.js";
import { NotFoundError, ForbiddenError } from "../../../../../lib/utils/errors.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const ADMIN_DENY = "Solo administradores pueden modificar este recurso";

export const PUT = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("training")) throw new ForbiddenError();
  const role = request.headers.get("x-user-role");
  if (!ADMIN_ROLES.has(role)) return forbidden(ADMIN_DENY);

  const { Course } = tenantModels;
  const { id } = await params;
  const body = await request.json();

  const course = await Course.findByPk(id);
  if (!course) throw new NotFoundError("Curso no encontrado");

  const allowed = ["name", "wpCourseId", "wcProductId", "active"];
  const updates = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  await course.update(updates);
  return ok(course);
});

export const DELETE = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("training")) throw new ForbiddenError();
  const role = request.headers.get("x-user-role");
  if (!ADMIN_ROLES.has(role)) return forbidden(ADMIN_DENY);

  const { Course } = tenantModels;
  const { id } = await params;

  const course = await Course.findByPk(id);
  if (!course) throw new NotFoundError("Curso no encontrado");

  await course.destroy();
  return new Response(null, { status: 204 });
});
