import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, error, serverError } from "../../../../lib/utils/apiResponse.js";

/**
 * GET /api/training/course-registrations
 *
 * Listado paginado de registros previos al curso (form inicial Retorika).
 * JWT + hasModule(training).
 *
 * Filtros:
 *   - courseId    UUID del Course
 *   - companyId   UUID de la Company
 *   - search      texto en email / centerName / centerNif (iLIKE)
 *   - from, to    rango ISO sobre submittedAt
 *   - page, limit (default 25, max 100)
 *
 * Orden: submittedAt DESC.
 *
 * Devuelve campos resumidos por fila (sin centerData/teacherData/
 * diagnosisData completos — eso va por el endpoint /[id]).
 */
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("training")) return forbidden("Módulo training no activo");

    const { CourseRegistration, Course, Company, TrainingUser } = tenantModels;
    const { searchParams } = new URL(request.url);

    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "25", 10)));
    const offset = (page - 1) * limit;

    const where = {};
    if (searchParams.get("courseId")) where.courseId = searchParams.get("courseId");
    if (searchParams.get("companyId")) where.companyId = searchParams.get("companyId");

    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (from || to) {
      where.submittedAt = {};
      if (from) where.submittedAt[Op.gte] = new Date(from);
      if (to) where.submittedAt[Op.lte] = new Date(to);
    }

    const q = (searchParams.get("search") || "").trim();
    if (q) {
      where[Op.or] = [
        { email: { [Op.iLike]: `%${q}%` } },
        { centerName: { [Op.iLike]: `%${q}%` } },
        { centerNif: { [Op.iLike]: `%${q}%` } },
      ];
    }

    const { count, rows } = await CourseRegistration.findAndCountAll({
      where,
      include: [
        { model: Course, as: "course", attributes: ["id", "name"] },
        { model: Company, as: "company", attributes: ["id", "name"] },
        { model: TrainingUser, as: "trainingUser", attributes: ["id", "name", "email"] },
      ],
      attributes: ["id", "email", "centerName", "centerNif", "submittedAt", "wpProductId", "wpCourseId"],
      order: [["submittedAt", "DESC"]],
      limit,
      offset,
    });

    return ok({
      total: count,
      page,
      limit,
      data: rows.map((r) => {
        const j = r.toJSON();
        return {
          id: j.id,
          email: j.email,
          centerName: j.centerName,
          centerNif: j.centerNif,
          submittedAt: j.submittedAt,
          wpProductId: j.wpProductId,
          wpCourseId: j.wpCourseId,
          course: j.course ?? null,
          company: j.company ?? null,
          trainingUser: j.trainingUser ?? null,
        };
      }),
    });
  } catch (err) {
    return serverError(err);
  }
});
