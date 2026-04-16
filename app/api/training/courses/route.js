import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created } from "../../../../lib/utils/apiResponse.js";
import { ValidationError, ForbiddenError } from "../../../../lib/utils/errors.js";

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("training")) throw new ForbiddenError();

  const { Course } = tenantModels;
  const { searchParams } = new URL(request.url);
  const activeParam = searchParams.get("active");

  const where = {};
  if (activeParam === "true") where.active = true;
  if (activeParam === "false") where.active = false;

  const courses = await Course.findAll({
    where,
    order: [["name", "ASC"]],
  });

  return ok(courses);
});

export const POST = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("training")) throw new ForbiddenError();

  const { Course } = tenantModels;
  const body = await request.json();
  const { name, wpCourseId, wcProductId, active } = body;

  if (!name?.trim()) throw new ValidationError("El campo name es obligatorio");

  const course = await Course.create({
    name: name.trim(),
    wpCourseId: wpCourseId ?? null,
    wcProductId: wcProductId ?? null,
    active: active !== undefined ? active : true,
  });

  return created(course);
});
