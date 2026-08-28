import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "../../../../../lib/utils/apiResponse.js";
import { palabrasDe, escaparLike } from "../../../../../lib/utils/busqueda.js";
import { hasUnaccentSupport } from "../../../../../lib/utils/busquedaDb.js";

/**
 * GET /api/training/quiz-attempts/stats?search=&companyName=&courseId=&quizId=
 *
 * Estadísticas agregadas de los intentos de cuestionario para el módulo
 * "Cuestionarios" del CRM. Dos modos según haya quizId:
 *
 *   - Modo A (sin quizId): visión global del tenant — totales agregados
 *     y rankings de cuestionarios (top por nº intentos y top por menor
 *     % aprobado, este último con umbral HAVING COUNT(*) >= 3 para evitar
 *     ruido de quizzes con 1-2 intentos).
 *   - Modo B (con quizId): focus en un cuestionario concreto — totales
 *     + agregación pregunta-a-pregunta del `answers[]` JSONB.
 *
 * Coherencia 3-vías con /list y los endpoints auxiliares (courses-list,
 * quizzes-list, companies-list): mismo WHERE construido en buildRawWhere().
 *
 * Auth: JWT + hasModule("training"), igual que el alias /api/cuestionarios.
 * Hasta el 10/08/2026 la puerta era `training || cuestionarios`, porque
 * Cuestionarios se vendía como módulo aparte. Ya no: los intentos son una
 * pantalla de Formación y su clave propia no la gatea nada.
 *
 * Identidad de pregunta: (questionId, no). El texto y type se toman del
 * primer intento encontrado — heurística "suficientemente buena" porque
 * TutorLMS rara vez reformula. Si Belén reformula y necesita stats
 * versionadas, hace falta otro modelo Quiz/Question (backlog).
 */
export const GET = withTenant(async (request, _ctx, { tenantSequelize, hasModule, slug }) => {
  try {
    if (!hasModule("training")) {
      return forbidden("Módulo no activo");
    }
    const { searchParams } = new URL(request.url);
    const schema = `crm_${slug}`;

    const search = (searchParams.get("search") || "").trim();
    const companyName = (searchParams.get("companyName") || "").trim();
    const courseIdRaw = searchParams.get("courseId");
    const quizIdRaw = searchParams.get("quizId");
    const courseId = courseIdRaw ? parseInt(courseIdRaw, 10) : null;
    const quizId = quizIdRaw ? parseInt(quizIdRaw, 10) : null;

    /*
     * ¿Se pueden ignorar las tildes? Se pregunta UNA vez aquí porque
     * `buildRawWhere` es síncrona y se llama varias veces. Si la base no
     * tuviera `unaccent`, se busca igual pero distinguiendo tildes: se pierde
     * comodidad, no resultados de los que ya salían.
     */
    const conTildes = await hasUnaccentSupport(tenantSequelize);
    const campo = (c) => (conTildes ? `unaccent(lower(${c}))` : `lower(${c})`);
    // El `$` del parámetro y el `::text` NO son adorno. Sin el `$` se escribe el
    // número a pelo y sale `unaccent(5)`; sin el tipo, un parámetro suelto dentro
    // de `unaccent()` no tiene tipo y Postgres no sabe cuál de sus dos versiones
    // usar. Las dos cosas dan lo mismo: «no existe la función unaccent(integer)»,
    // un 500 en cuanto alguien escribe algo en la caja. Aquí no hay modelo que
    // ponga el tipo por nosotros, como sí hace Sequelize en el resto.
    const patron = (n) => (conTildes ? `unaccent($${n}::text)` : `$${n}`);

    // WHERE crudo compartido. includeQuizId controla si añadimos el filtro
    // por wp_quiz_id (necesario en modo B, omitido en modo A para los
    // rankings globales).
    function buildRawWhere({ includeQuizId, extraClauses = [], startIdx = 1 } = {}) {
      const clauses = [...extraClauses];
      const binds = [];
      let idx = startIdx;
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
      if (includeQuizId && quizId) {
        clauses.push(`wp_quiz_id = $${idx}`);
        binds.push(quizId);
        idx++;
      }
      /*
       * Todas las palabras, cada una en cualquiera de los cuatro campos
       * (28/08/2026) — la MISMA regla que la tabla de abajo
       * (`app/api/training/quiz-attempts/route.js`). Tienen que ir a la par: si
       * la cabecera contara con una regla y la tabla con otra, quien busque
       * «hugo castro» vería tres filas debajo de un total que dice 0.
       *
       * Una cláusula por palabra, con su propio parámetro, respetando la
       * numeración que lleva `idx` (los rankings arrancan en `startIdx`). Los
       * nombres de columna son constantes escritas aquí, nunca vienen de la
       * petición; lo que escribe la persona viaja SOLO por `binds`.
       */
      if (search) {
        for (const palabra of palabrasDe(search)) {
          clauses.push(
            `(${campo("student_name")} LIKE ${patron(idx)}` +
            ` OR ${campo("student_email")} LIKE ${patron(idx)}` +
            ` OR ${campo("quiz_title")} LIKE ${patron(idx)}` +
            ` OR ${campo("course_title")} LIKE ${patron(idx)})`
          );
          binds.push(`%${escaparLike(palabra)}%`);
          idx++;
        }
      }
      return {
        whereSql: clauses.length ? "WHERE " + clauses.join(" AND ") : "",
        binds,
      };
    }

    // ── Totales (mismo cálculo en ambos modos) ──────────────────────────
    const includeQuizIdInTotals = !!quizId;
    const totalsW = buildRawWhere({ includeQuizId: includeQuizIdInTotals });
    const [totalsRows] = await tenantSequelize.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE result = 'pass')::int AS pass_count,
         COUNT(*) FILTER (WHERE result = 'fail')::int AS fail_count,
         COALESCE(AVG(earned_points / NULLIF(total_points, 0)) * 100, 0)::float AS avg_score_pct
       FROM "${schema}"."quiz_attempts"
       ${totalsW.whereSql}`,
      { bind: totalsW.binds }
    );

    const t = totalsRows[0] || { total: 0, pass_count: 0, fail_count: 0, avg_score_pct: 0 };
    const total = t.total;
    const passCount = t.pass_count;
    const failCount = t.fail_count;
    const passRate = total ? Math.round((passCount / total) * 10000) / 100 : 0;
    const avgScorePct = Math.round((parseFloat(t.avg_score_pct) || 0) * 100) / 100;

    // ── Modo A: rankings globales ───────────────────────────────────────
    if (!quizId) {
      // Top por nº intentos (NULLs en wp_quiz_id excluidos)
      const topAW = buildRawWhere({
        includeQuizId: false,
        extraClauses: ["wp_quiz_id IS NOT NULL"],
      });
      const [topAttRows] = await tenantSequelize.query(
        `SELECT wp_quiz_id, quiz_title, COUNT(*)::int AS cnt
         FROM "${schema}"."quiz_attempts"
         ${topAW.whereSql}
         GROUP BY 1, 2
         ORDER BY cnt DESC, quiz_title ASC NULLS LAST
         LIMIT 5`,
        { bind: topAW.binds }
      );

      // Top por menor % aprobado (HAVING COUNT(*) >= 3 para evitar ruido
      // de quizzes con un único intento).
      const topFW = buildRawWhere({
        includeQuizId: false,
        extraClauses: ["wp_quiz_id IS NOT NULL"],
      });
      const [topFailRows] = await tenantSequelize.query(
        `SELECT wp_quiz_id,
                quiz_title,
                COUNT(*)::int AS cnt,
                (COUNT(*) FILTER (WHERE result = 'pass')::float
                  / NULLIF(COUNT(*), 0) * 100) AS pass_rate,
                (AVG(earned_points / NULLIF(total_points, 0)) * 100) AS avg_score_pct
         FROM "${schema}"."quiz_attempts"
         ${topFW.whereSql}
         GROUP BY 1, 2
         HAVING COUNT(*) >= 3
         ORDER BY pass_rate ASC NULLS LAST, cnt DESC
         LIMIT 5`,
        { bind: topFW.binds }
      );

      const topQuizzesByAttempts = topAttRows.map((r) => ({
        wpQuizId: r.wp_quiz_id,
        quizTitle: r.quiz_title,
        count: r.cnt,
      }));

      const topQuizzesByFailRate = topFailRows.map((r) => ({
        wpQuizId: r.wp_quiz_id,
        quizTitle: r.quiz_title,
        count: r.cnt,
        passRate: r.pass_rate != null ? Math.round(parseFloat(r.pass_rate) * 100) / 100 : 0,
        avgScorePct: r.avg_score_pct != null
          ? Math.round(parseFloat(r.avg_score_pct) * 100) / 100
          : 0,
      }));

      process.stdout.write(
        `[retorika:quiz-stats] modeA total=${total} passRate=${passRate} avgScore=${avgScorePct} topAtt=${topQuizzesByAttempts.length} topFail=${topQuizzesByFailRate.length}\n`
      );

      return ok({
        total,
        passCount,
        failCount,
        passRate,
        avgScorePct,
        topQuizzesByAttempts,
        topQuizzesByFailRate,
      });
    }

    // ── Modo B: agregación pregunta-a-pregunta ──────────────────────────
    // Traemos todos los answers[] del quiz filtrado y agrupamos en JS por
    // (questionId, no). Para el texto y type cogemos el primer intento.
    const aggW = buildRawWhere({ includeQuizId: true });
    const [attemptRows] = await tenantSequelize.query(
      `SELECT answers
       FROM "${schema}"."quiz_attempts"
       ${aggW.whereSql}`,
      { bind: aggW.binds }
    );

    const byKey = new Map();
    for (const r of attemptRows) {
      const arr = Array.isArray(r.answers) ? r.answers : [];
      for (const ans of arr) {
        if (!ans || typeof ans !== "object") continue;
        const noRaw = ans.no;
        const no = Number.isInteger(noRaw) ? noRaw : parseInt(noRaw, 10) || null;
        const qid = ans.questionId ?? null;
        const key = `${qid}|${no}`;
        if (!byKey.has(key)) {
          byKey.set(key, {
            no,
            questionId: qid,
            question: ans.question ?? "",
            type: ans.type ?? "unknown",
            totalResponses: 0,
            correctCount: 0,
          });
        }
        const slot = byKey.get(key);
        slot.totalResponses++;
        if (ans.isCorrect === true || ans.isCorrect === 1 || ans.isCorrect === "1") {
          slot.correctCount++;
        }
      }
    }

    const questionStats = Array.from(byKey.values())
      .map((s) => ({
        ...s,
        correctRate: s.totalResponses
          ? Math.round((s.correctCount / s.totalResponses) * 10000) / 100
          : 0,
      }))
      .sort((a, b) => (a.no ?? 9999) - (b.no ?? 9999));

    process.stdout.write(
      `[retorika:quiz-stats] modeB quizId=${quizId} total=${total} passRate=${passRate} avgScore=${avgScorePct} questions=${questionStats.length}\n`
    );

    return ok({
      total,
      passCount,
      failCount,
      passRate,
      avgScorePct,
      questionStats,
    });
  } catch (err) {
    return serverError(err);
  }
});
