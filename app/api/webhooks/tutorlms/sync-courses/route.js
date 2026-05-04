import { getTenantContext } from "../../../../../lib/tenant/tenantResolver.js";
import { handleRouteError } from "../../../../../lib/utils/errors.js";
import { verifyHmacSignature } from "../../../../../lib/training/webhookAuth.js";
import { NextResponse } from "next/server";
import { Op } from "sequelize";

// POST /api/webhooks/tutorlms/sync-courses
// Sync completo: recibe lista de cursos activos en WordPress y desactiva los ausentes.
export async function POST(request) {
  try {
    const rawBody = await request.text();
    const signatureHeader = request.headers.get("x-retorika-signature");

    if (!verifyHmacSignature(rawBody, signatureHeader)) {
      return NextResponse.json({ ok: false, error: "Firma inválida" }, { status: 401 });
    }

    const { courses } = JSON.parse(rawBody);

    if (!Array.isArray(courses)) {
      return NextResponse.json({ ok: false, error: "courses debe ser un array" }, { status: 400 });
    }

    const ctx = await getTenantContext(request);
    if (!ctx.hasModule("training")) {
      return NextResponse.json(
        { ok: false, error: "Módulo training no activo en este tenant" },
        { status: 403 }
      );
    }
    const { Course } = ctx.tenantModels;

    // Upsert de cada curso recibido
    for (const item of courses) {
      const { course_id, course_title, wc_product_id } = item;
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
    }

    // Desactivar cursos activos que no aparecen en el sync
    const wpCourseIds = courses.map((c) => c.course_id);
    const toDeactivate = await Course.findAll({
      where: {
        active: true,
        wpCourseId: { [Op.notIn]: wpCourseIds },
      },
    });

    if (toDeactivate.length > 0) {
      await Course.update(
        { active: false },
        { where: { id: toDeactivate.map((c) => c.id) } }
      );
    }

    return NextResponse.json({
      ok: true,
      synced: courses.length,
      deactivated: toDeactivate.length,
      deactivated_courses: toDeactivate.map((c) => c.name),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
