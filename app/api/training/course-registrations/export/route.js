import { NextResponse } from "next/server";
import { Op } from "sequelize";
import ExcelJS from "exceljs";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { forbidden, error, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import {
  CENTER_TYPE,
  POSITIONS,
  COURSES_TEACHING,
  SUBJECTS,
  TOPICS_OF_INTEREST,
  DIAGNOSIS_FULL_QUESTIONS,
  labelOr,
  joinSlugs,
} from "../../../../../lib/training/registrationLabels.js";

/**
 * GET /api/training/course-registrations/export?courseId=<uuid>&companyId=<uuid>?
 *
 * Exporta los registros previos de un curso (filtrable por empresa, fecha
 * y búsqueda) a XLSX (ExcelJS). JWT + hasModule(training).
 *
 * Formato:
 *   - Workbook con 2 hojas:
 *       · "Registros" — 30 columnas con cabeceras humanas cortas.
 *       · "Diccionario de preguntas" — preguntas completas + tipo escala.
 *   - submittedAt como Date nativo Excel (numFmt dd/mm/yyyy hh:mm) para
 *     que Bea pueda filtrar/ordenar como fecha real, no como texto.
 *   - Arrays (positions, subjects…) resueltos a etiquetas humanas vía
 *     diccionarios de lib/training/registrationLabels.js (no slugs crudos).
 *   - Cabecera negrita, panel congelado (ySplit=1), autofilter en A1:AD1.
 *   - Content-Disposition: attachment; filename="registros-curso-{slug}-{date}.xlsx".
 */

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

// Hoja 1 — 30 columnas, orden determinista. Si cambia el modelo, ajustar aquí.
const SHEET_COLUMNS = [
  { header: "Fecha inscripción", key: "submittedAt", width: 18 },
  { header: "Curso", key: "courseName", width: 30 },
  { header: "Nombre completo", key: "trainingUserName", width: 28 },
  { header: "Email", key: "trainingUserEmail", width: 30 },
  { header: "Empresa", key: "companyName", width: 25 },
  { header: "Tipo centro educativo", key: "centerType", width: 25 },
  { header: "Nombre del centro", key: "centerName", width: 28 },
  { header: "Centro (otro)", key: "centerOtherName", width: 22 },
  { header: "NIF/CIF", key: "centerNif", width: 14 },
  { header: "Dirección", key: "addressStreet", width: 30 },
  { header: "Apartamento, habitación, escalera, etc.", key: "addressApartment", width: 25 },
  { header: "Ciudad", key: "addressCity", width: 18 },
  { header: "Estado/Provincia", key: "addressState", width: 18 },
  { header: "CP", key: "addressPostalCode", width: 8 },
  { header: "País", key: "addressCountry", width: 8 },
  { header: "Años de experiencia", key: "yearsOfExperience", width: 12 },
  { header: "Cargo", key: "positions", width: 28 },
  { header: "Cursos en los que enseña", key: "coursesTeaching", width: 30 },
  { header: "Asignaturas que imparte", key: "subjects", width: 30 },
  { header: "Temática de interés en formación", key: "topicsOfInterest", width: 30 },
  { header: "Motivación actual", key: "motivationCurrent", width: 12 },
  { header: "Motivación vs inicial", key: "motivationVsStart", width: 13 },
  { header: "Ambiente centro", key: "centerEnvironment", width: 13 },
  { header: "Nivel estrés", key: "stressLevel", width: 12 },
  { header: "Recursos", key: "hasResources", width: 12 },
  { header: "Reconocimiento social", key: "socialRecognition", width: 15 },
  { header: "Frecuencia carga", key: "workloadFrequency", width: 15 },
  { header: "Horas extra semanales", key: "weeklyExtraHours", width: 15 },
  { header: "Principales dificultades", key: "mainDifficulties", width: 60 },
  { header: "Objetivos del curso", key: "courseGoals", width: 60 },
];

// Hoja 2 — preguntas completas (las cabeceras de la Hoja 1 son acortadas).
// El texto largo de cada pregunta es fuente única en
// lib/training/registrationLabels.js → DIAGNOSIS_FULL_QUESTIONS. Aquí
// solo aportamos la "columna" (cabecera corta de la Hoja 1) y el "tipo
// escala" para cada clave. Object.keys preserva orden de inserción, así
// que DICTIONARY_ROWS sale en este mismo orden (10 filas).
const DICTIONARY_SCALE_TYPES = {
  motivationCurrent:  { columna: "Motivación actual",        tipo: "Likert 1-5" },
  motivationVsStart:  { columna: "Motivación vs inicial",    tipo: "Likert 1-5" },
  centerEnvironment:  { columna: "Ambiente centro",          tipo: "Likert 1-5" },
  stressLevel:        { columna: "Nivel estrés",             tipo: "Likert 1-5" },
  hasResources:       { columna: "Recursos",                 tipo: "Likert 1-5" },
  socialRecognition:  { columna: "Reconocimiento social",    tipo: "Likert 1-5" },
  workloadFrequency:  { columna: "Frecuencia carga",         tipo: "Escala etiquetada" },
  weeklyExtraHours:   { columna: "Horas extra semanales",    tipo: "Rango" },
  mainDifficulties:   { columna: "Principales dificultades", tipo: "Texto libre" },
  courseGoals:        { columna: "Objetivos del curso",      tipo: "Texto libre" },
};

const DICTIONARY_ROWS = Object.keys(DICTIONARY_SCALE_TYPES).map((key) => ({
  columna: DICTIONARY_SCALE_TYPES[key].columna,
  pregunta: DIAGNOSIS_FULL_QUESTIONS[key],
  tipo: DICTIONARY_SCALE_TYPES[key].tipo,
}));

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
    // el curso (comportamiento histórico). Si vienen, el XLSX refleja
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

    // ── Construir XLSX ────────────────────────────────────────────────────────
    const workbook = new ExcelJS.Workbook();

    // Hoja 1 — Registros
    const sheet = workbook.addWorksheet("Registros");
    sheet.columns = SHEET_COLUMNS;
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = "A1:AD1";

    for (const row of rows) {
      const j = row.toJSON();
      const center = j.centerData ?? {};
      const addr = center.address ?? {};
      const teacher = j.teacherData ?? {};
      const diag = j.diagnosisData ?? {};

      const added = sheet.addRow({
        submittedAt: j.submittedAt ? new Date(j.submittedAt) : null,
        courseName: j.course?.name ?? "",
        trainingUserName: j.trainingUser?.name ?? "",
        trainingUserEmail: j.trainingUser?.email ?? "",
        companyName: j.company?.name ?? "",
        centerType: labelOr(CENTER_TYPE, center.type),
        centerName: center.name ?? "",
        centerOtherName: center.otherName ?? "",
        // Fallback histórico: registros antiguos solo tienen NIF dentro del JSONB.
        centerNif: j.centerNif ?? center.nif ?? "",
        addressStreet: addr.street ?? "",
        addressApartment: addr.apartment ?? "",
        addressCity: addr.city ?? "",
        addressState: addr.state ?? "",
        addressPostalCode: addr.postalCode ?? "",
        addressCountry: addr.country ?? "",
        yearsOfExperience: teacher.yearsOfExperience ?? "",
        positions: joinSlugs(POSITIONS, teacher.positions),
        coursesTeaching: joinSlugs(COURSES_TEACHING, teacher.coursesTeaching),
        subjects: joinSlugs(SUBJECTS, teacher.subjects),
        topicsOfInterest: joinSlugs(TOPICS_OF_INTEREST, teacher.topicsOfInterest),
        motivationCurrent: diag.motivationCurrent ?? "",
        motivationVsStart: diag.motivationVsStart ?? "",
        centerEnvironment: diag.centerEnvironment ?? "",
        stressLevel: diag.stressLevel ?? "",
        hasResources: diag.hasResources ?? "",
        socialRecognition: diag.socialRecognition ?? "",
        workloadFrequency: diag.workloadFrequency ?? "",
        weeklyExtraHours: diag.weeklyExtraHours ?? "",
        mainDifficulties: diag.mainDifficulties ?? "",
        courseGoals: diag.courseGoals ?? "",
      });

      // Date nativo de Excel para que Bea pueda filtrar/ordenar la
      // columna como fecha. Sin numFmt, Excel la mostraría como número
      // serial (45000+) en algunos locales.
      const dateCell = added.getCell(1);
      if (dateCell.value instanceof Date) {
        dateCell.numFmt = "dd/mm/yyyy hh:mm";
      }
    }

    // Hoja 2 — Diccionario de preguntas
    const dict = workbook.addWorksheet("Diccionario de preguntas");
    dict.columns = [
      { header: "Columna", key: "columna", width: 28 },
      { header: "Pregunta completa", key: "pregunta", width: 90 },
      { header: "Tipo escala", key: "tipo", width: 18 },
    ];
    dict.getRow(1).font = { bold: true };
    for (const r of DICTIONARY_ROWS) {
      const added = dict.addRow(r);
      added.getCell(2).alignment = { wrapText: true, vertical: "top" };
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const date = new Date().toISOString().slice(0, 10);
    const courseSlug = slugify(course.name);
    const filename = `registros-curso-${courseSlug}-${date}.xlsx`;

    process.stdout.write(
      `[retorika:export] courseId=${courseId} rows=${rows.length} filename=${filename}\n`
    );

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
