import { getTenantContext } from "../../../../../lib/tenant/tenantResolver.js";
import { handleRouteError } from "../../../../../lib/utils/errors.js";
import { verifyHmacSignature } from "../../../../../lib/training/webhookAuth.js";
import { NextResponse } from "next/server";

// POST /api/webhooks/tutorlms/course
// Sincronización de cursos TutorLMS → CRM. Sin JWT (HMAC + hasModule).
export async function POST(request) {
  try {
    const rawBody = await request.text();
    const signatureHeader = request.headers.get("x-retorika-signature");

    if (!verifyHmacSignature(rawBody, signatureHeader)) {
      return NextResponse.json({ ok: false, error: "Firma inválida" }, { status: 401 });
    }

    const payload = JSON.parse(rawBody);
    const { action, course_id, course_title, wc_product_id } = payload;

    const ctx = await getTenantContext(request);
    if (!ctx.hasModule("training")) {
      return NextResponse.json(
        { ok: false, error: "Módulo training no activo en este tenant" },
        { status: 403 }
      );
    }
    const { Course } = ctx.tenantModels;

    if (action === "delete") {
      const course = await Course.findOne({ where: { wpCourseId: course_id } });
      if (course) {
        await course.update({ active: false });
        return NextResponse.json({ ok: true, action, courseId: course.id });
      }
      return NextResponse.json({ ok: true, action, courseId: null });
    }

    if (action === "publish" || action === "update") {
      const [course, created] = await Course.findOrCreate({
        where: { wpCourseId: course_id },
        defaults: {
          name: course_title,
          wpCourseId: course_id,
          wcProductId: wc_product_id ?? null,
          active: true,
        },
      });

      if (!created) {
        await course.update({
          name: course_title,
          wcProductId: wc_product_id ?? null,
          active: true,
        });
      }

      return NextResponse.json({ ok: true, action, courseId: course.id });
    }

    return NextResponse.json({ ok: false, error: "Acción desconocida" }, { status: 400 });
  } catch (err) {
    return handleRouteError(err);
  }
}
