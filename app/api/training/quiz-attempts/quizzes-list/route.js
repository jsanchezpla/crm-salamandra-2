import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "../../../../../lib/utils/apiResponse.js";

/**
 * GET /api/training/quiz-attempts/quizzes-list?courseId=&companyName=
 *
 * Lista DISTINCT de cuestionarios con intentos en el tenant. Sirve para
 * poblar el dropdown "Cuestionario" en /formacion/cuestionarios.
 *
 * Sin tabla `quizzes`/`questions` en el modelo, la lista se deriva por
 * DISTINCT sobre `quiz_attempts` — implicación: cuestionarios sin ningún
 * intento NO aparecen aquí (no los conoce el CRM). Backlog si Belén lo
 * pide.
 *
 * Ordenados por count DESC para que los más usados queden arriba.
 *
 * Auth: JWT + hasModule("training" || "cuestionarios").
 */
export const GET = withTenant(async (request, _ctx, { tenantSequelize, hasModule, slug }) => {
  try {
    if (!hasModule("training") && !hasModule("cuestionarios")) {
      return forbidden("Módulo no activo");
    }
    const { searchParams } = new URL(request.url);
    const schema = `crm_${slug}`;

    const companyName = (searchParams.get("companyName") || "").trim();
    const courseIdRaw = searchParams.get("courseId");
    const courseId = courseIdRaw ? parseInt(courseIdRaw, 10) : null;

    const clauses = ["wp_quiz_id IS NOT NULL"];
    const binds = [];
    let idx = 1;
    if (companyName) {
      clauses.push(`empresa ILIKE $${idx}`);
      binds.push(`%${companyName}%`);
      idx++;
    }
    if (courseId) {
      clauses.push(`wp_course_id = $${idx}`);
      binds.push(courseId);
      idx++;
    }
    const whereSql = "WHERE " + clauses.join(" AND ");

    const [rows] = await tenantSequelize.query(
      `SELECT wp_quiz_id, quiz_title, wp_course_id, course_title, COUNT(*)::int AS cnt
       FROM "${schema}"."quiz_attempts"
       ${whereSql}
       GROUP BY 1, 2, 3, 4
       ORDER BY cnt DESC, quiz_title ASC NULLS LAST`,
      { bind: binds }
    );

    const items = rows.map((r) => ({
      wpQuizId: r.wp_quiz_id,
      quizTitle: r.quiz_title,
      wpCourseId: r.wp_course_id,
      courseTitle: r.course_title,
      count: r.cnt,
    }));

    return ok({ items });
  } catch (err) {
    return serverError(err);
  }
});
