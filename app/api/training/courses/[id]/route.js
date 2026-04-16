import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../../lib/utils/apiResponse.js";
import { NotFoundError, ForbiddenError } from "../../../../../lib/utils/errors.js";

export const PUT = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("training")) throw new ForbiddenError();

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

  const { Course } = tenantModels;
  const { id } = await params;

  const course = await Course.findByPk(id);
  if (!course) throw new NotFoundError("Curso no encontrado");

  await course.destroy();
  return new Response(null, { status: 204 });
});
