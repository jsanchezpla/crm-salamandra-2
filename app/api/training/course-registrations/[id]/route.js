import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";

/**
 * GET /api/training/course-registrations/[id]
 *
 * Detalle completo de un registro: campos directos + centerData +
 * teacherData + diagnosisData + relaciones (course, company, trainingUser).
 * JWT + hasModule(training).
 */
export const GET = withTenant(async (_request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("training")) return forbidden("Módulo training no activo");
    const { id } = await params;
    const { CourseRegistration, Course, Company, TrainingUser } = tenantModels;

    const row = await CourseRegistration.findByPk(id, {
      include: [
        { model: Course, as: "course", attributes: ["id", "name", "wpCourseId", "wcProductId"] },
        { model: Company, as: "company", attributes: ["id", "name", "nif"] },
        { model: TrainingUser, as: "trainingUser", attributes: ["id", "name", "lastName", "email"] },
      ],
    });
    if (!row) return notFound("Registro no encontrado");

    return ok(row.toJSON());
  } catch (err) {
    return serverError(err);
  }
});
