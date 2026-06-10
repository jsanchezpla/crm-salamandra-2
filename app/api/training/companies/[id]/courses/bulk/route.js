import { withTenant } from "../../../../../../../lib/tenant/withTenant.js";
import { ok, forbidden } from "../../../../../../../lib/utils/apiResponse.js";
import { NotFoundError, ValidationError, ForbiddenError } from "../../../../../../../lib/utils/errors.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const ADMIN_DENY = "Solo administradores pueden modificar este recurso";

/**
 * POST /api/training/companies/[id]/courses/bulk
 *
 * Body:
 *   {
 *     "courseIds": ["<uuid>", ...],
 *     "propagateToActive": true | false       // opcional, default false
 *   }
 *
 * Asigna varios cursos a una empresa en una sola transacción. Idempotente
 * por la UNIQUE (company_id, course_id) en `company_courses`. Si
 * `propagateToActive` es true, además materializa las matrículas en
 * `course_enrollments` para los TrainingUser ya activos de la empresa —
 * misma semántica que el query param `?propagateToActive=true` del endpoint
 * single-course, pero aplicada al lote completo.
 *
 * Respuesta:
 *   {
 *     "companyId": "<uuid>",
 *     "added": [{ "courseId": "<uuid>", "wasNew": boolean }, ...],
 *     "propagated": null | {
 *        "users": <N>,
 *        "totalEnrollmentsCreated": <K>,
 *        "perCourse": [{ "courseId": "<uuid>", "created": <k>, "skipped": <s> }, ...]
 *     }
 *   }
 */
export const POST = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("training")) throw new ForbiddenError();
  const role = request.headers.get("x-user-role");
  if (!ADMIN_ROLES.has(role)) return forbidden(ADMIN_DENY);

  const { Company, Course, CompanyCourse, TrainingUser, CourseEnrollment } = tenantModels;
  const { id } = await params;

  const body = await request.json();
  const { courseIds, propagateToActive } = body ?? {};
  if (!Array.isArray(courseIds) || courseIds.length === 0) {
    throw new ValidationError("courseIds debe ser un array no vacío");
  }
  const uniqueIds = [...new Set(courseIds.map(String))];

  const company = await Company.findByPk(id, { attributes: ["id"] });
  if (!company) throw new NotFoundError("Empresa no encontrada");

  // Validar que todos los cursos existen en el tenant ANTES de tocar nada.
  const courses = await Course.findAll({ where: { id: uniqueIds }, attributes: ["id"] });
  if (courses.length !== uniqueIds.length) {
    const foundIds = new Set(courses.map((c) => c.id));
    const missing = uniqueIds.filter((cid) => !foundIds.has(cid));
    throw new NotFoundError(`Curso(s) no encontrado(s): ${missing.join(", ")}`);
  }

  const sequelize = CompanyCourse.sequelize;
  const added = [];
  let propagated = null;

  await sequelize.transaction(async (t) => {
    for (const courseId of uniqueIds) {
      const [, wasNew] = await CompanyCourse.findOrCreate({
        where: { companyId: id, courseId },
        transaction: t,
      });
      added.push({ courseId, wasNew });
    }

    if (!propagateToActive) return;

    const activeUsers = await TrainingUser.findAll({
      where: { companyId: id, type: "company", active: true },
      attributes: ["id"],
      transaction: t,
    });

    if (activeUsers.length === 0) {
      propagated = { users: 0, totalEnrollmentsCreated: 0, perCourse: [] };
      return;
    }

    const perCourse = [];
    let totalCreated = 0;
    const propagatedAt = new Date().toISOString();
    for (const courseId of uniqueIds) {
      let created = 0;
      let skipped = 0;
      for (const u of activeUsers) {
        const [, wasCreated] = await CourseEnrollment.findOrCreate({
          where: { trainingUserId: u.id, courseId },
          defaults: {
            trainingUserId: u.id,
            courseId,
            companyId: id,
            metadata: { source: "bulk_propagateToActive", propagatedAt },
          },
          transaction: t,
        });
        if (wasCreated) created++;
        else skipped++;
      }
      perCourse.push({ courseId, created, skipped });
      totalCreated += created;
    }
    propagated = { users: activeUsers.length, totalEnrollmentsCreated: totalCreated, perCourse };
    console.log(
      `[training] bulk propagateToActive companyId=${id} courses=${uniqueIds.length} users=${activeUsers.length} totalCreated=${totalCreated}`
    );
  });

  return ok({ companyId: id, added, propagated });
});
