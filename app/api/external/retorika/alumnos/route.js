import { NextResponse } from "next/server";
import { Op } from "sequelize";
import { verifyApiKey } from "../../../../../lib/utils/apiKeyAuth.js";
import { getTenantDb } from "../../../../../lib/db/tenantDb.js";
import { filtroPorNombre } from "../../../../../lib/utils/busqueda.js";

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

    const { models, sequelize } = getTenantDb(SLUG);
    const { TrainingUser, Company, CourseEnrollment, Course } = models;

    const where = {};
    /*
     * Todas las palabras, cada una en cualquiera de los campos (28/08/2026), y
     * ahora también en el apellido, que no se buscaba. Lo consume la web de
     * Retorika, así que el cambio se ha hecho de forma que solo puede AÑADIR
     * resultados: lo que hoy encuentra, lo seguirá encontrando (una frase que
     * cabe entera en una columna tiene todas sus palabras en esa columna).
     * Ver `lib/utils/busqueda.js`.
     */
    if (search) {
      const porNombre = await filtroPorNombre(sequelize, search, [
        "TrainingUser.name", "TrainingUser.last_name", "TrainingUser.email",
      ]);
      if (porNombre) (where[Op.and] ||= []).push(porNombre);
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
            // Aquí enrollmentWhere solo lleva courseId, una clave normal, así
            // que esto sí funcionaba. Se iguala a Reflect.ownKeys para que no
            // dependa de eso: una clave de Sequelize (Op.*) es un symbol y
            // Object.keys no la ve — es lo que tenía roto el buscador de
            // Matrículas.
            where: Reflect.ownKeys(enrollmentWhere).length ? enrollmentWhere : undefined,
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
