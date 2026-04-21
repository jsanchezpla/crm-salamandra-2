import { NextResponse } from "next/server";
import { verifyApiKey } from "../../../../../lib/utils/apiKeyAuth.js";
import { getTenantDb } from "../../../../../lib/db/tenantDb.js";

const SLUG = "retorika";

export async function GET(request) {
  if (!verifyApiKey(request)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  try {
    const { models } = getTenantDb(SLUG);
    const { Course, TrainingUser, CourseEnrollment } = models;

    const courses = await Course.findAll({
      include: [
        {
          model: TrainingUser,
          as: "enrolledUsers",
          through: {
            model: CourseEnrollment,
            as: "enrollment",
            attributes: ["enrolledAt"],
          },
          attributes: ["id", "name", "email"],
          required: false,
        },
      ],
      order: [["name", "ASC"]],
    });

    const data = courses.map((c) => {
      const course = c.toJSON();
      const students = (course.enrolledUsers || []).map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        enrolledAt: u.CourseEnrollment?.enrolledAt ?? null,
      }));
      return {
        id: course.id,
        name: course.name,
        wpCourseId: course.wpCourseId,
        wcProductId: course.wcProductId,
        active: course.active,
        enrollmentCount: students.length,
        students,
      };
    });

    return NextResponse.json({ ok: true, total: data.length, data });
  } catch (err) {
    console.error("[external/retorika/cursos] GET error:", err);
    return NextResponse.json({ ok: false, error: "Error interno del servidor" }, { status: 500 });
  }
}
