import { NextResponse } from "next/server";
import { Op } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { forbidden, error, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import {
  CENTER_TYPE,
  POSITIONS,
  COURSES_TEACHING,
  SUBJECTS,
  TOPICS_OF_INTEREST,
  labelOr,
  joinSlugs,
} from "../../../../../lib/training/registrationLabels.js";

/**
 * GET /api/training/course-registrations/export?courseId=<uuid>&companyId=<uuid>?
 *
 * Exporta los registros previos de un curso (filtrable por empresa) a CSV.
 * JWT + hasModule(training).
 *
 * Formato:
 *   - text/csv UTF-8 con BOM (﻿) para que Excel lo abra bien.
 *   - Separador: coma (,).
 *   - Valores con coma interna: encerrados en doble comilla, doble comilla
 *     interna escapada como "".
 *   - Arrays: comma-separated labels resueltos por diccionario (no slugs crudos).
 *   - Headers Content-Disposition: attachment; filename="registros-curso-{slug}-{date}.csv".
 */

// Escape CSV: valor que contenga `,`, `"`, `\n` o `\r` va entre comillas y
// las comillas internas se doblan.
function csvCell(value) {
  if (value == null) return "";
  const s = String(value);
  if (s === "") return "";
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(cells) {
  return cells.map(csvCell).join(",");
}

function slugify(input, fallback = "registros") {
  if (!input) return fallback;
  return String(input)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || fallback;
}

// Cabecera CSV — orden determinista. Si añades nuevos campos al modelo,
// añádelos también aquí.
const CSV_HEADERS = [
  "id",
  "submittedAt",
  "email",
  "wpUserId",
  "wpProductId",
  "wpCourseId",
  "courseName",
  "trainingUserName",
  "trainingUserEmail",
  "companyName",
  // Centro
  "centerType",
  "centerName",
  "centerOtherName",
  "centerNif",
  "addressStreet",
  "addressApartment",
  "addressCity",
  "addressState",
  "addressPostalCode",
  "addressCountry",
  // Docente
  "yearsOfExperience",
  "positions",
  "coursesTeaching",
  "subjects",
  "topicsOfInterest",
  // Diagnóstico
  "motivationCurrent",
  "motivationVsStart",
  "centerEnvironment",
  "stressLevel",
  "hasResources",
  "socialRecognition",
  "workloadFrequency",
  "weeklyExtraHours",
  "mainDifficulties",
  "courseGoals",
];

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule, slug }) => {
  try {
    if (!hasModule("training")) return forbidden("Módulo training no activo");
    const { CourseRegistration, Course, Company, TrainingUser } = tenantModels;
    const { searchParams } = new URL(request.url);
    const courseId = searchParams.get("courseId");
    if (!courseId) return error("courseId obligatorio");

    const course = await Course.findByPk(courseId, { attributes: ["id", "name"] });
    if (!course) return notFound("Curso no encontrado");

    const where = { courseId };
    if (searchParams.get("companyId")) where.companyId = searchParams.get("companyId");

    // Filtros adicionales: search / from / to. Si no vienen, se exporta todo
    // el curso (comportamiento histórico). Si vienen, el CSV refleja
    // exactamente lo que el usuario ve en pantalla.
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (from || to) {
      where.submittedAt = {};
      if (from) where.submittedAt[Op.gte] = new Date(from);
      if (to) where.submittedAt[Op.lte] = new Date(to);
    }
    const q = (searchParams.get("search") || "").trim();
    if (q) {
      where[Op.or] = [
        { email: { [Op.iLike]: `%${q}%` } },
        { centerName: { [Op.iLike]: `%${q}%` } },
        { centerNif: { [Op.iLike]: `%${q}%` } },
      ];
    }

    const rows = await CourseRegistration.findAll({
      where,
      include: [
        { model: Course, as: "course", attributes: ["id", "name"] },
        { model: Company, as: "company", attributes: ["id", "name"] },
        { model: TrainingUser, as: "trainingUser", attributes: ["id", "name", "email"] },
      ],
      order: [["submittedAt", "DESC"]],
    });

    const lines = [csvRow(CSV_HEADERS)];

    for (const row of rows) {
      const j = row.toJSON();
      const center = j.centerData ?? {};
      const addr = center.address ?? {};
      const teacher = j.teacherData ?? {};
      const diag = j.diagnosisData ?? {};

      lines.push(
        csvRow([
          j.id,
          j.submittedAt ? new Date(j.submittedAt).toISOString() : "",
          j.email,
          j.wpUserId ?? "",
          j.wpProductId ?? "",
          j.wpCourseId ?? "",
          j.course?.name ?? "",
          j.trainingUser?.name ?? "",
          j.trainingUser?.email ?? "",
          j.company?.name ?? "",
          // Centro
          labelOr(CENTER_TYPE, center.type),
          center.name ?? "",
          center.otherName ?? "",
          j.centerNif ?? center.nif ?? "",
          addr.street ?? "",
          addr.apartment ?? "",
          addr.city ?? "",
          addr.state ?? "",
          addr.postalCode ?? "",
          addr.country ?? "",
          // Docente
          teacher.yearsOfExperience ?? "",
          joinSlugs(POSITIONS, teacher.positions),
          joinSlugs(COURSES_TEACHING, teacher.coursesTeaching),
          joinSlugs(SUBJECTS, teacher.subjects),
          joinSlugs(TOPICS_OF_INTEREST, teacher.topicsOfInterest),
          // Diagnóstico
          diag.motivationCurrent ?? "",
          diag.motivationVsStart ?? "",
          diag.centerEnvironment ?? "",
          diag.stressLevel ?? "",
          diag.hasResources ?? "",
          diag.socialRecognition ?? "",
          diag.workloadFrequency ?? "",
          diag.weeklyExtraHours ?? "",
          diag.mainDifficulties ?? "",
          diag.courseGoals ?? "",
        ])
      );
    }

    // BOM ﻿ → Excel detecta UTF-8 automáticamente.
    const body = "﻿" + lines.join("\r\n") + "\r\n";

    const date = new Date().toISOString().slice(0, 10);
    const courseSlug = slugify(course.name);
    const filename = `registros-curso-${courseSlug}-${date}.csv`;

    process.stdout.write(
      `[retorika:export] courseId=${courseId} rows=${rows.length} filename=${filename}\n`
    );

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
