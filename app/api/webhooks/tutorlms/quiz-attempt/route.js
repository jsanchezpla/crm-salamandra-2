import { getTenantContext } from "../../../../../lib/tenant/tenantResolver.js";
import { handleRouteError } from "../../../../../lib/utils/errors.js";
import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";

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

    const [record] = await QuizAttempt.upsert(
      {
        wpAttemptId: payload.attempt_id,
        wpQuizId: payload.quiz_id ?? 0,
        wpCourseId: payload.course_id ?? 0,
        wpUserId: payload.user_id ?? 0,
        studentName: payload.student_name ?? null,
        studentEmail: payload.student_email ?? null,
        quizTitle: payload.quiz_title ?? null,
        courseTitle: payload.course_title ?? null,
        empresa: payload.empresa ?? null,
        attemptDate: payload.attempt_date ? new Date(payload.attempt_date) : null,
        totalQuestions: payload.total_questions ?? null,
        totalPoints: payload.total_points ?? null,
        earnedPoints: payload.earned_points ?? null,
        passingPoints: payload.passing_points ?? null,
        correctAnswers: payload.correct_answers ?? null,
        incorrectAnswers: payload.incorrect_answers ?? null,
        quizTime: payload.quiz_time ?? null,
        attemptTime: payload.attempt_time ?? null,
        result: payload.result === "pass" ? "pass" : "fail",
        answers,
      },
      { conflictFields: ["wp_attempt_id"] }
    );

    return NextResponse.json({ ok: true, attemptId: record.id });
  } catch (err) {
    return handleRouteError(err);
  }
}
