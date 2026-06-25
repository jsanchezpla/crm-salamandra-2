import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "../../../../../lib/utils/apiResponse.js";

/**
 * GET /api/training/quiz-attempts/courses-list
 *
 * Lista DISTINCT de cursos con intentos en el tenant. Sirve para poblar
 * el dropdown "Curso" en /formacion/cuestionarios.
 *
 * Sin filtros — devuelve todos los cursos que tienen al menos un intento.
 * Cursos sin intentos no aparecen (no se cruzan con la tabla `courses`,
 * porque el filtro luego se aplica sobre wp_course_id de quiz_attempts).
 *
 * Auth: JWT + hasModule("training" || "cuestionarios").
 */
export const GET = withTenant(async (_request, _ctx, { tenantSequelize, hasModule, slug }) => {
  try {
    if (!hasModule("training") && !hasModule("cuestionarios")) {
      return forbidden("Módulo no activo");
    }
    const schema = `crm_${slug}`;

    const [rows] = await tenantSequelize.query(
      `SELECT wp_course_id, course_title, COUNT(*)::int AS cnt
       FROM "${schema}"."quiz_attempts"
       WHERE wp_course_id IS NOT NULL
       GROUP BY 1, 2
       ORDER BY course_title ASC NULLS LAST`
    );

    const items = rows.map((r) => ({
      wpCourseId: r.wp_course_id,
      courseTitle: r.course_title,
      count: r.cnt,
    }));

    return ok({ items });
  } catch (err) {
    return serverError(err);
  }
});
