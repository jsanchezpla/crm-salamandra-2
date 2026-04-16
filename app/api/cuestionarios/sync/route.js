import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden } from "../../../../lib/utils/apiResponse.js";
import { ValidationError } from "../../../../lib/utils/errors.js";

const WP_URL = process.env.WP_URL;
const WP_API_USER = process.env.WP_API_USER;
const WP_API_KEY = process.env.WP_API_KEY;

/**
 * Convierte segundos a formato "Xm Ys"
 */
function formatSeconds(secs) {
  if (!secs && secs !== 0) return null;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

/**
 * Obtiene el detalle completo de un intento desde TutorLMS.
 * Endpoint: GET /wp-json/tutor/v1/quiz-attempts/{id}
 */
async function fetchAttemptDetail(attemptId, authHeader) {
  const res = await fetch(`${WP_URL}/wp-json/tutor/v1/quiz-attempts/${attemptId}`, {
    headers: { Authorization: authHeader },
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json?.data ?? json ?? null;
}

/**
 * POST /api/cuestionarios/sync
 *
 * Body (opcional):
 *   { page: 1, perPage: 50, courseId: 123, quizId: 456, fetchDetails: true }
 *
 * Sincroniza intentos desde TutorLMS y los guarda/actualiza en la BD.
 * Devuelve { synced, skipped, errors }.
 */
export const POST = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("training") && !hasModule("cuestionarios")) return forbidden();

  if (!WP_URL || !WP_API_USER || !WP_API_KEY) {
    throw new ValidationError(
      "Faltan variables de entorno: WP_URL, WP_API_USER o WP_API_KEY"
    );
  }

  const { QuizAttempt } = tenantModels;
  const body = await request.json().catch(() => ({}));

  const page = body.page ?? 1;
  const perPage = Math.min(body.perPage ?? 50, 100);
  const fetchDetails = body.fetchDetails !== false; // por defecto true

  const authHeader =
    "Basic " + Buffer.from(`${WP_API_USER}:${WP_API_KEY}`).toString("base64");

  // Construir URL con filtros opcionales
  const params = new URLSearchParams({ page, per_page: perPage });
  if (body.courseId) params.set("course_id", body.courseId);
  if (body.quizId) params.set("quiz_id", body.quizId);

  const listRes = await fetch(
    `${WP_URL}/wp-json/tutor/v1/quiz-attempts?${params.toString()}`,
    { headers: { Authorization: authHeader } }
  );

  if (!listRes.ok) {
    throw new ValidationError(
      `Error al conectar con TutorLMS: ${listRes.status} ${listRes.statusText}`
    );
  }

  const listJson = await listRes.json();
  // TutorLMS puede devolver { data: [...] } o directamente un array
  const rawAttempts = Array.isArray(listJson) ? listJson : (listJson?.data ?? []);

  let synced = 0;
  let skipped = 0;
  const errors = [];

  for (const raw of rawAttempts) {
    try {
      const wpAttemptId = parseInt(raw.attempt_id ?? raw.id);
      if (!wpAttemptId) {
        skipped++;
        continue;
      }

      // Obtener detalle completo si se solicita
      let detail = raw;
      if (fetchDetails) {
        const fetched = await fetchAttemptDetail(wpAttemptId, authHeader);
        if (fetched) detail = fetched;
      }

      // Mapear preguntas al formato interno
      const answers = (detail.questions ?? detail.quiz_questions ?? []).map((q, idx) => ({
        no: idx + 1,
        questionId: q.question_id ?? q.id ?? null,
        type: q.question_type ?? "unknown",
        question: q.question_title ?? q.title ?? "",
        givenAnswer: q.given_answer ?? q.answer_given ?? "",
        correctAnswer: q.correct_answer ?? "",
        isCorrect: q.is_correct === 1 || q.is_correct === true || q.is_correct === "1",
        marks: parseFloat(q.question_mark ?? q.marks ?? 0),
      }));

      // Calcular tiempo de intento en segundos si vienen como strings "Xm Ys"
      let attemptTimeSecs = null;
      if (detail.attempt_duration_taken) {
        const match = String(detail.attempt_duration_taken).match(/(\d+)m\s*(\d+)s/);
        if (match) attemptTimeSecs = parseInt(match[1]) * 60 + parseInt(match[2]);
      } else if (detail.attempt_time) {
        attemptTimeSecs = parseInt(detail.attempt_time);
      }

      let quizTimeSecs = null;
      if (detail.time_limit) {
        quizTimeSecs = parseInt(detail.time_limit);
      }

      const data = {
        wpAttemptId,
        wpQuizId: parseInt(detail.quiz_id ?? detail.course_quiz_id ?? 0),
        wpCourseId: parseInt(detail.course_id ?? 0),
        wpUserId: parseInt(detail.user_id ?? detail.student_id ?? 0),
        studentName: detail.display_name ?? detail.user_name ?? detail.student_name ?? null,
        studentEmail: detail.user_email ?? detail.student_email ?? null,
        quizTitle: detail.quiz_title ?? detail.title ?? null,
        courseTitle: detail.course_title ?? null,
        empresa: detail.empresa ?? null,
        attemptDate: detail.attempt_start_at
          ? new Date(detail.attempt_start_at)
          : detail.created_at
            ? new Date(detail.created_at)
            : null,
        totalQuestions: parseInt(detail.total_questions ?? detail.total_answered_questions ?? answers.length ?? 0),
        totalPoints: parseFloat(detail.total_marks ?? detail.total_points ?? 0),
        earnedPoints: parseFloat(detail.earned_marks ?? detail.earned_points ?? 0),
        passingPoints: parseFloat(detail.passing_marks ?? detail.passing_points ?? 0),
        correctAnswers: parseInt(detail.total_correct_answers ?? detail.correct_answers ?? 0),
        incorrectAnswers: parseInt(detail.total_wrong_answers ?? detail.incorrect_answers ?? 0),
        quizTime: quizTimeSecs,
        attemptTime: attemptTimeSecs,
        result: (detail.result === "pass" || detail.passed === true || detail.passed === 1)
          ? "pass"
          : "fail",
        answers,
      };

      await QuizAttempt.upsert(data, { conflictFields: ["wpAttemptId"] });
      synced++;
    } catch (err) {
      errors.push({ attemptId: raw.attempt_id ?? raw.id, error: err.message });
    }
  }

  return ok({ synced, skipped, errors, total: rawAttempts.length });
});
