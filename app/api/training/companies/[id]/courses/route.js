import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, forbidden } from "../../../../../../lib/utils/apiResponse.js";
import { NotFoundError, ValidationError, ForbiddenError } from "../../../../../../lib/utils/errors.js";

export const GET = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("training")) throw new ForbiddenError();

  const { Company, Course } = tenantModels;
  const { id } = await params;

  const company = await Company.findByPk(id);
  if (!company) throw new NotFoundError("Empresa no encontrada");

  const courses = await company.getCourses({ as: "courses" });
  return ok(courses);
});

export const POST = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("training")) throw new ForbiddenError();

  const { Company, Course, CompanyCourse } = tenantModels;
  const { id } = await params;
  const body = await request.json();
  const { courseId } = body;

  if (!courseId) throw new ValidationError("El campo courseId es obligatorio");

  const [company, course] = await Promise.all([
    Company.findByPk(id),
    Course.findByPk(courseId),
  ]);

  if (!company) throw new NotFoundError("Empresa no encontrada");
  if (!course) throw new NotFoundError("Curso no encontrado");

  // Idempotente: si ya existe no lanza error
  await CompanyCourse.findOrCreate({
    where: { companyId: id, courseId },
  });

  return ok({ companyId: id, courseId });
});
