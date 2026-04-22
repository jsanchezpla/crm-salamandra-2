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

// POST /api/webhooks/tutorlms/course
// Sincronización de cursos TutorLMS → CRM. Sin JWT, sin hasModule.
export async function POST(request) {
  try {
    const rawBody = await request.text();
    const signatureHeader = request.headers.get("x-retorika-signature");

    if (!verifySignature(rawBody, signatureHeader)) {
      return NextResponse.json({ ok: false, error: "Firma inválida" }, { status: 401 });
    }

    const payload = JSON.parse(rawBody);
    const { action, course_id, course_title, wc_product_id } = payload;

    const ctx = await getTenantContext(request);
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
