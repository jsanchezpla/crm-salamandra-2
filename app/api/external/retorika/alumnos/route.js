import { NextResponse } from "next/server";
import { Op } from "sequelize";
import { verifyApiKey } from "../../../../../lib/utils/apiKeyAuth.js";
import { getTenantDb } from "../../../../../lib/db/tenantDb.js";

const SLUG = "retorika";
const AUTO_PAGINATE_THRESHOLD = 500;
const DEFAULT_LIMIT = 100;

export async function GET(request) {
  if (!verifyApiKey(request)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const courseId = searchParams.get("courseId");
    const companyId = searchParams.get("companyId");
    const search = searchParams.get("search");
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limitParam = parseInt(searchParams.get("limit") || "0", 10);

    const { models } = getTenantDb(SLUG);
    const { TrainingUser, Company, CourseEnrollment, Course } = models;

    const where = {};
    if (search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
      ];
    }
    if (companyId) {
      where.companyId = companyId;
    }

    const enrollmentWhere = {};
    if (courseId) {
      enrollmentWhere.courseId = courseId;
    }

    const rows = await TrainingUser.findAll({
      where,
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
            where: Object.keys(enrollmentWhere).length ? enrollmentWhere : undefined,
          },
          attributes: ["id", "name", "wpCourseId", "wcProductId"],
          required: !!courseId,
        },
      ],
      order: [["name", "ASC"]],
    });

    const total = rows.length;

    // Paginación automática si supera el umbral
    let data;
    if (total > AUTO_PAGINATE_THRESHOLD || limitParam > 0) {
      const limit = limitParam > 0 ? limitParam : DEFAULT_LIMIT;
      const offset = (page - 1) * limit;
      const slice = rows.slice(offset, offset + limit);
      data = formatAlumnos(slice);
      return NextResponse.json({
        ok: true,
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
        data,
      });
    }

    data = formatAlumnos(rows);
    return NextResponse.json({ ok: true, total, data });
  } catch (err) {
    console.error("[external/retorika/alumnos] GET error:", err);
    return NextResponse.json({ ok: false, error: "Error interno del servidor" }, { status: 500 });
  }
}

function formatAlumnos(rows) {
  return rows.map((u) => {
    const user = u.toJSON();
    return {
      id: user.id,
      name: user.name,
      lastName: user.lastName,
      email: user.email,
      username: user.username,
      type: user.type,
      company: user.company ? { id: user.company.id, name: user.company.name } : null,
      active: user.active,
      enrollments: (user.enrolledCourses || []).map((c) => ({
        courseId: c.id,
        courseName: c.name,
        wpCourseId: c.wpCourseId,
        wcProductId: c.wcProductId,
        enrolledAt: c.enrollment?.enrolledAt ?? null,
      })),
    };
  });
}
