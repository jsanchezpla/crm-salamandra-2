import { getTenantContext } from "../../../../../lib/tenant/tenantResolver.js";
import { handleRouteError } from "../../../../../lib/utils/errors.js";
import { verifyWebhookSignature } from "../../../../../lib/training/webhookAuth.js";
import { NextResponse } from "next/server";
import { QueryTypes as SequelizeQueryTypes } from "sequelize";

// POST /api/webhooks/tutorlms/quiz-attempt
// Recibe intentos de quiz en tiempo real desde TutorLMS (WordPress).
// Sin JWT (HMAC + hasModule).
export async function POST(request) {
  try {
    const rawBody = await request.text();
    const signatureHeader = request.headers.get("x-retorika-signature");

    if (!(await verifyWebhookSignature(rawBody, signatureHeader, request))) {
      return NextResponse.json({ ok: false, error: "Firma inválida" }, { status: 401 });
    }

    const payload = JSON.parse(rawBody);
    const ctx = await getTenantContext(request);
    if (!ctx.hasModule("training")) {
      return NextResponse.json(
        { ok: false, error: "Módulo training no activo en este tenant" },
        { status: 403 }
      );
    }
    const { QuizAttempt } = ctx.tenantModels;
    const sequelize = QuizAttempt.sequelize;
    const schema = `crm_${ctx.slug}`;

    const wpAttemptId = parseInt(payload.attempt_id, 10);

    const data = {
      wpAttemptId,
      wpQuizId:        parseInt(payload.quiz_id ?? 0, 10),
      wpCourseId:      parseInt(payload.course_id ?? 0, 10),
      wpUserId:        parseInt(payload.user_id ?? 0, 10),
      studentName:     payload.student_name ?? null,
      studentEmail:    payload.student_email ?? null,
      quizTitle:       payload.quiz_title ?? null,
      courseTitle:     payload.course_title ?? null,
      empresa:         payload.empresa ?? null,
      attemptDate:     payload.attempt_date ? new Date(payload.attempt_date) : null,
      totalQuestions:  parseInt(payload.total_questions ?? 0, 10),
      totalPoints:     parseFloat(payload.total_points ?? 0),
      earnedPoints:    parseFloat(payload.earned_points ?? 0),
      passingPoints:   parseFloat(payload.passing_points ?? 0),
      correctAnswers:  parseInt(payload.correct_answers ?? 0, 10),
      incorrectAnswers: parseInt(payload.incorrect_answers ?? 0, 10),
      quizTime:        parseInt(payload.quiz_time ?? 0, 10),
      attemptTime:     parseInt(payload.attempt_time ?? 0, 10),
      result:          payload.result === "pass" ? "pass" : "fail",
      answers:         payload.answers ?? [],
    };

    // Comprobar si existe el registro
    const [existing] = await sequelize.query(
      `SELECT id FROM "${schema}".quiz_attempts WHERE wp_attempt_id = :wpAttemptId LIMIT 1`,
      { replacements: { wpAttemptId }, type: SequelizeQueryTypes.SELECT }
    );

    let attemptId;
    if (existing) {
      await sequelize.query(
        `UPDATE "${schema}".quiz_attempts SET
          student_name      = :studentName,
          student_email     = :studentEmail,
          quiz_title        = :quizTitle,
          course_title      = :courseTitle,
          empresa           = :empresa,
          attempt_date      = :attemptDate,
          total_questions   = :totalQuestions,
          total_points      = :totalPoints,
          earned_points     = :earnedPoints,
          passing_points    = :passingPoints,
          correct_answers   = :correctAnswers,
          incorrect_answers = :incorrectAnswers,
          quiz_time         = :quizTime,
          attempt_time      = :attemptTime,
          result            = :result,
          answers           = :answers::jsonb,
          updated_at        = NOW()
        WHERE wp_attempt_id = :wpAttemptId`,
        {
          replacements: {
            studentName:      data.studentName,
            studentEmail:     data.studentEmail,
            quizTitle:        data.quizTitle,
            courseTitle:      data.courseTitle,
            empresa:          data.empresa,
            attemptDate:      data.attemptDate,
            totalQuestions:   data.totalQuestions,
            totalPoints:      data.totalPoints,
            earnedPoints:     data.earnedPoints,
            passingPoints:    data.passingPoints,
            correctAnswers:   data.correctAnswers,
            incorrectAnswers: data.incorrectAnswers,
            quizTime:         data.quizTime,
            attemptTime:      data.attemptTime,
            result:           data.result,
            answers:          JSON.stringify(data.answers),
            wpAttemptId,
          },
          type: SequelizeQueryTypes.UPDATE,
        }
      );

      attemptId = existing.id;
    } else {
      const record = await QuizAttempt.create(data);
      attemptId = record.id;
    }

    return NextResponse.json({ ok: true, attemptId });
  } catch (err) {
    return handleRouteError(err);
  }
}
