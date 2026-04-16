import { getTenantContext } from "../../../../../lib/tenant/tenantResolver.js";
import { handleRouteError } from "../../../../../lib/utils/errors.js";
import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";

const WEBHOOK_SECRET = "CabalooGalopante726517893561378";

// Nil UUID para registros creados desde webhooks externos (sin usuario master)
const WEBHOOK_USER_ID = "00000000-0000-0000-0000-000000000000";

function verifySignature(rawBody, signature) {
  if (!signature) return false;
  const expected = createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// POST /api/webhooks/tutorlms/quiz-attempt
// Endpoint crítico — lo llama TutorLMS (WordPress).
export async function POST(request) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-retorika-signature");

    if (!verifySignature(rawBody, signature)) {
      return NextResponse.json({ ok: false, error: "Firma inválida" }, { status: 401 });
    }

    const payload = JSON.parse(rawBody);
    const ctx = await getTenantContext(request);
    const { Training, TrainingUser, Course } = ctx.tenantModels;

    // Resolver curso y usuario del tenant a partir de los IDs de WordPress
    const [course, trainingUser] = await Promise.all([
      payload.course_id
        ? Course.findOne({ where: { wpCourseId: payload.course_id } })
        : null,
      payload.student_email
        ? TrainingUser.findOne({ where: { email: payload.student_email.toLowerCase() } })
        : null,
    ]);

    await Training.create({
      userId: WEBHOOK_USER_ID,
      title: payload.quiz_title ?? payload.course_title ?? "Quiz attempt",
      type: "course",
      status: payload.result === "pass" ? "completed" : "in_progress",
      provider: "TutorLMS",
      courseId: course?.id ?? null,
      trainingUserId: trainingUser?.id ?? null,
      customFields: {
        source: "tutorlms_webhook",
        wpQuizId: payload.quiz_id ?? null,
        wpCourseId: payload.course_id ?? null,
        wpUserId: payload.user_id ?? null,
        wpAttemptId: payload.attempt_id ?? null,
        studentEmail: payload.student_email ?? null,
        studentName: payload.student_name ?? null,
        quizTitle: payload.quiz_title ?? null,
        courseTitle: payload.course_title ?? null,
        result: payload.result ?? null,
        totalQuestions: payload.total_questions ?? null,
        totalPoints: payload.total_points ?? null,
        earnedPoints: payload.earned_points ?? null,
        passingPoints: payload.passing_points ?? null,
        correctAnswers: payload.correct_answers ?? null,
        incorrectAnswers: payload.incorrect_answers ?? null,
        quizTime: payload.quiz_time ?? null,
        attemptTime: payload.attempt_time ?? null,
        attemptDate: payload.attempt_date ?? null,
        answers: payload.answers ?? [],
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
