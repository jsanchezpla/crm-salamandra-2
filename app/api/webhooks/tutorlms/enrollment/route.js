import { getTenantContext } from "../../../../../lib/tenant/tenantResolver.js";
import { handleRouteError } from "../../../../../lib/utils/errors.js";
import { verifyHmacSignature } from "../../../../../lib/training/webhookAuth.js";
import { NextResponse } from "next/server";

async function processEnrollment(payload, tenantModels) {
  const { TrainingUser, Course, CourseEnrollment } = tenantModels;

  const email = payload.user_email?.trim().toLowerCase();
  if (!email) throw new Error("user_email requerido");

  // Buscar o crear TrainingUser
  let user = await TrainingUser.findOne({ where: { email } });
  if (!user) {
    user = await TrainingUser.create({
      email,
      name: payload.display_name?.trim() || null,
      type: "private",
      active: true,
      externalUserId: payload.user_id ?? null,
    });
  } else if (!user.externalUserId && payload.user_id) {
    await user.update({ externalUserId: payload.user_id });
  }

  // Buscar o crear Course
  let course = await Course.findOne({ where: { wpCourseId: payload.course_id } });
  if (!course) {
    course = await Course.create({
      name: payload.course_title?.trim() || `Curso ${payload.course_id}`,
      wpCourseId: payload.course_id,
      active: true,
    });
  }

  // Buscar o crear matrícula (idempotente por unique index)
  const [, created] = await CourseEnrollment.findOrCreate({
    where: { trainingUserId: user.id, courseId: course.id },
    defaults: {
      enrolledAt: payload.enrolled_at ? new Date(payload.enrolled_at) : new Date(),
      metadata: { source: "tutorlms_webhook", wpUserId: payload.user_id ?? null },
    },
  });

  return created;
}

// POST /api/webhooks/tutorlms/enrollment
export async function POST(request) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-retorika-signature");

    if (!verifyHmacSignature(rawBody, signature)) {
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

    await processEnrollment(payload, ctx.tenantModels);

    return NextResponse.json({ ok: true, message: "Matrícula registrada." });
  } catch (err) {
    return handleRouteError(err);
  }
}
