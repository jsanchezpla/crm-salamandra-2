import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, forbidden } from "../../../../../../lib/utils/apiResponse.js";
import { NotFoundError, ValidationError, ForbiddenError } from "../../../../../../lib/utils/errors.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const ADMIN_DENY = "Solo administradores pueden modificar este recurso";

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
  const role = request.headers.get("x-user-role");
  if (!ADMIN_ROLES.has(role)) return forbidden(ADMIN_DENY);

  const { Company, Course, CompanyCourse, TrainingUser, CourseEnrollment } = tenantModels;
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

  // Idempotente: si ya existe no lanza error.
  // Opcional: propagar la asignación a las matrículas individuales de los
  // empleados YA activos de la empresa (los pre-aprobados todavía no activos
  // recibirán el curso cuando se activen vía /register/empresa).
  const propagate = new URL(request.url).searchParams.get("propagateToActive") === "true";
  const sequelize = CompanyCourse.sequelize;

  let propagated = null;

  await sequelize.transaction(async (t) => {
    await CompanyCourse.findOrCreate({
      where: { companyId: id, courseId },
      transaction: t,
    });

    if (!propagate) return;

    const activeUsers = await TrainingUser.findAll({
      where: { companyId: id, type: "company", active: true },
      attributes: ["id"],
      transaction: t,
    });

    let created = 0;
    let skipped = 0;
    for (const u of activeUsers) {
      const [, wasCreated] = await CourseEnrollment.findOrCreate({
        where: { trainingUserId: u.id, courseId },
        defaults: {
          trainingUserId: u.id,
          courseId,
          companyId: id,
          metadata: {
            source: "propagateToActive",
            propagatedAt: new Date().toISOString(),
          },
        },
        transaction: t,
      });
      if (wasCreated) created++;
      else skipped++;
    }

    propagated = { users: activeUsers.length, created, skipped };
    console.log(
      `[training] propagateToActive companyId=${id} courseId=${courseId} users=${activeUsers.length} created=${created} skipped=${skipped}`
    );
  });

  const responseBody = { companyId: id, courseId };
  if (propagated) responseBody.propagated = propagated;
  return ok(responseBody);
});
