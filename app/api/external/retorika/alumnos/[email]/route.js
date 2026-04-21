import { NextResponse } from "next/server";
import { verifyApiKey } from "../../../../../../lib/utils/apiKeyAuth.js";
import { getTenantDb } from "../../../../../../lib/db/tenantDb.js";

const SLUG = "retorika";

export async function GET(request, { params }) {
  if (!verifyApiKey(request)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  try {
    const email = decodeURIComponent(params.email).toLowerCase();

    const { models } = getTenantDb(SLUG);
    const { TrainingUser, Company, Course, CourseEnrollment } = models;

    const user = await TrainingUser.findOne({
      where: { email },
      include: [
        {
          model: Company,
          as: "company",
          attributes: ["id", "name"],
          required: false,
        },
        {
          model: Course,
          as: "enrolledCourses",
          through: {
            model: CourseEnrollment,
            as: "enrollment",
            attributes: ["enrolledAt"],
          },
          attributes: ["id", "name", "wpCourseId", "wcProductId"],
          required: false,
        },
      ],
    });

    if (!user) {
      return NextResponse.json({ ok: false, error: "Alumno no encontrado" }, { status: 404 });
    }

    const u = user.toJSON();
    return NextResponse.json({
      ok: true,
      data: {
        id: u.id,
        name: u.name,
        lastName: u.lastName,
        email: u.email,
        username: u.username,
        type: u.type,
        company: u.company ? { id: u.company.id, name: u.company.name } : null,
        active: u.active,
        enrollments: (u.enrolledCourses || []).map((c) => ({
          courseId: c.id,
          courseName: c.name,
          wpCourseId: c.wpCourseId,
          wcProductId: c.wcProductId,
          enrolledAt: c.CourseEnrollment?.enrolledAt ?? null,
        })),
      },
    });
  } catch (err) {
    console.error("[external/retorika/alumnos/:email] GET error:", err);
    return NextResponse.json({ ok: false, error: "Error interno del servidor" }, { status: 500 });
  }
}
