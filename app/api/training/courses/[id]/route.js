import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, forbidden } from "../../../../../lib/utils/apiResponse.js";
import { NotFoundError, ValidationError, ForbiddenError } from "../../../../../lib/utils/errors.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const ADMIN_DENY = "Solo administradores pueden modificar este recurso";

/**
 * Lógica compartida PUT/PATCH: edición parcial de un curso por whitelist.
 * Reusada por ambos verbos para no divergir.
 */
async function updateCourse(request, { params }, { tenantModels, hasModule }) {
  if (!hasModule("training")) throw new ForbiddenError();
  const role = request.headers.get("x-user-role");
  if (!ADMIN_ROLES.has(role)) return forbidden(ADMIN_DENY);

  const { Course } = tenantModels;
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const course = await Course.findByPk(id);
  if (!course) throw new NotFoundError("Curso no encontrado");

  const updates = {};

  if ("name" in body) {
    const name = String(body.name ?? "").trim();
    if (!name) throw new ValidationError("El campo name no puede estar vacío");
    updates.name = name;
  }
  if ("wpCourseId" in body) {
    if (body.wpCourseId === null || body.wpCourseId === "") {
      updates.wpCourseId = null;
    } else {
      const n = parseInt(body.wpCourseId, 10);
      if (!Number.isFinite(n) || n < 0) {
        throw new ValidationError("wpCourseId debe ser entero >= 0 o null");
      }
      updates.wpCourseId = n;
    }
  }
  if ("wcProductId" in body) {
    if (body.wcProductId === null || body.wcProductId === "") {
      updates.wcProductId = null;
    } else {
      const n = parseInt(body.wcProductId, 10);
      if (!Number.isFinite(n) || n <= 0) {
        throw new ValidationError("wcProductId debe ser entero positivo o null");
      }
      updates.wcProductId = n;
    }
  }
  if ("active" in body) {
    updates.active = !!body.active;
  }

  if (Object.keys(updates).length === 0) return ok(course);

  await course.update(updates);
  console.log(
    `[training:course-update] id=${id} fields=${Object.keys(updates).join(",")}`
  );
  return ok(course);
}

export const GET = withTenant(async (_request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("training")) throw new ForbiddenError();
  const { Course } = tenantModels;
  const { id } = await params;
  const course = await Course.findByPk(id);
  if (!course) throw new NotFoundError("Curso no encontrado");
  return ok(course);
});

export const PUT = withTenant(updateCourse);
export const PATCH = withTenant(updateCourse);

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
