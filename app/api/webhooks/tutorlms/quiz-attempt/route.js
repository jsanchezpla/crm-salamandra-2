import { getTenantContext } from "../../../../../lib/tenant/tenantResolver.js";
import { handleRouteError } from "../../../../../lib/utils/errors.js";
import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { literal } from "sequelize";

const WEBHOOK_SECRET = "CabalooGalopante726517893561378";

function verifySignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false;
  const signature = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice(7)
    : signatureHeader;
  const expected = createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// POST /api/webhooks/tutorlms/quiz-attempt
// Recibe intentos de quiz en tiempo real desde TutorLMS (WordPress). Sin JWT.
export async function POST(request) {
  try {
    const rawBody = await request.text();
    const signatureHeader = request.headers.get("x-retorika-signature");

    if (!verifySignature(rawBody, signatureHeader)) {
      return NextResponse.json({ ok: false, error: "Firma inválida" }, { status: 401 });
    }

    const payload = JSON.parse(rawBody);
    const ctx = await getTenantContext(request);
    const { QuizAttempt } = ctx.tenantModels;

    const wpAttemptId = parseInt(payload.attempt_id, 10);
    console.log("[QUIZ-ATTEMPT] wpAttemptId:", wpAttemptId, typeof wpAttemptId);

    const answers = (payload.answers ?? []).map((q, idx) => ({
      no: idx + 1,
      questionId: q.question_id ?? null,
      type: q.question_type ?? "unknown",
      question: q.question_title ?? q.question ?? "",
      givenAnswer: q.given_answer ?? "",
      correctAnswer: q.correct_answer ?? "",
      isCorrect: q.is_correct === true || q.is_correct === 1 || q.is_correct === "1",
      marks: parseFloat(q.question_mark ?? q.marks ?? 0),
    }));

    const data = {
      wpAttemptId,
      wpQuizId: parseInt(payload.quiz_id ?? 0, 10),
      wpCourseId: parseInt(payload.course_id ?? 0, 10),
      wpUserId: parseInt(payload.user_id ?? 0, 10),
      studentName: payload.student_name ?? null,
      studentEmail: payload.student_email ?? null,
      quizTitle: payload.quiz_title ?? null,
      courseTitle: payload.course_title ?? null,
      empresa: payload.empresa ?? null,
      attemptDate: payload.attempt_date ? new Date(payload.attempt_date) : null,
      totalQuestions: parseInt(payload.total_questions ?? 0, 10),
      totalPoints: parseFloat(payload.total_points ?? 0),
      earnedPoints: parseFloat(payload.earned_points ?? 0),
      passingPoints: parseFloat(payload.passing_points ?? 0),
      correctAnswers: parseInt(payload.correct_answers ?? 0, 10),
      incorrectAnswers: parseInt(payload.incorrect_answers ?? 0, 10),
      quizTime: parseInt(payload.quiz_time ?? 0, 10),
      attemptTime: parseInt(payload.attempt_time ?? 0, 10),
      result: payload.result === "pass" ? "pass" : "fail",
      answers,
    };

    // Usar literal SQL para evitar ambigüedad en el mapeo camelCase → snake_case
    const existing = await QuizAttempt.findOne({
      where: literal(`wp_attempt_id = ${wpAttemptId}`),
    });

    console.log("[QUIZ-ATTEMPT] existing:", existing ? `id=${existing.id}` : "null");

    let attemptId;
    if (existing) {
      await existing.update(data);
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
