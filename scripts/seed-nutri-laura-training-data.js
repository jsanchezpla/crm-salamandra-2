/**
 * seed-nutri-laura-training-data.js
 *
 * Llena el módulo Formación de nutri_laura con datos de prueba realistas
 * para las 5 secciones que muestra la UI (post-eliminación del override
 * nutri-laura/FormacionOverview, ahora usa el default igual que retorika):
 *   - 20 alumnos privados (B2C) con perfiles variados de nutrición.
 *   - ~35 matrículas distribuidas entre los 3 cursos existentes.
 *   - 3 empresas (gimnasio, centro deportivo, clínica) + 6 alumnos B2B
 *     vinculados a ellas + asignaciones CompanyCourse + matrículas B2B.
 *   - ~10 quiz attempts realistas (mix pass/fail con tiempos y puntos).
 *
 * Asume que el módulo ya está activo y los 3 cursos base existen
 * (los crea `scripts/add-training-module-nutri-laura.js`). Si no es así,
 * el script aborta con un mensaje claro.
 *
 * Idempotente:
 *   - `TrainingUser.email` UNIQUE → findOrCreate por email.
 *   - `CourseEnrollment.(trainingUserId, courseId)` UNIQUE → findOrCreate.
 *   - `Company.name` se busca con findOrCreate por nombre exacto.
 *   - `CompanyCourse.(companyId, courseId)` UNIQUE → findOrCreate.
 *   - `QuizAttempt.wpAttemptId` UNIQUE → findOrCreate por wpAttemptId.
 * Re-ejecutar no crea duplicados.
 *
 * Uso local:  node --env-file=.env.local scripts/seed-nutri-laura-training-data.js
 * Uso VPS:    docker compose exec app node scripts/seed-nutri-laura-training-data.js
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";

const SLUG = "nutri_laura";

function log(msg) {
  process.stdout.write(`  ${msg}\n`);
}
function header(msg) {
  process.stdout.write(`\n▶ ${msg}\n`);
}
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

// ─── Catálogo de alumnos B2C ──────────────────────────────────────────────────
// Perfiles variados para que la lista no parezca generada en batch.

const STUDENTS = [
  { name: "Marta",       lastName: "López García",        email: "marta.lopez@example.com",       country: "España", birthDate: "1989-03-12" },
  { name: "Laura",       lastName: "Fernández Ruiz",      email: "laura.fernandez.r@example.com", country: "España", birthDate: "1992-07-04" },
  { name: "Carolina",    lastName: "Vázquez Pérez",       email: "carolina.vazquez@example.com",  country: "España", birthDate: "1985-11-21" },
  { name: "Beatriz",     lastName: "Sanz Moreno",         email: "beatriz.sanz@example.com",      country: "España", birthDate: "1990-02-09" },
  { name: "Ana",         lastName: "Torres Iglesias",     email: "ana.torres@example.com",        country: "España", birthDate: "1978-08-30" },
  { name: "Sofía",       lastName: "Castro Delgado",      email: "sofia.castro@example.com",      country: "España", birthDate: "1994-05-17" },
  { name: "Lucía",       lastName: "Ramos Núñez",         email: "lucia.ramos@example.com",       country: "España", birthDate: "1987-12-03" },
  { name: "Elena",       lastName: "Ortega Vidal",        email: "elena.ortega@example.com",      country: "España", birthDate: "1983-04-25" },
  { name: "Cristina",    lastName: "Gómez Rey",           email: "cristina.gomez@example.com",    country: "España", birthDate: "1996-09-11" },
  { name: "Patricia",    lastName: "Jiménez Vega",        email: "patricia.jimenez@example.com",  country: "España", birthDate: "1981-06-14" },
  { name: "Daniel",      lastName: "Alonso Ríos",         email: "daniel.alonso@example.com",     country: "España", birthDate: "1988-10-02" },
  { name: "Javier",      lastName: "Romero Cano",         email: "javier.romero@example.com",     country: "España", birthDate: "1991-01-28" },
  { name: "Pablo",       lastName: "Marín Soler",         email: "pablo.marin@example.com",       country: "España", birthDate: "1986-07-19" },
  { name: "Isabel",      lastName: "Cabrera Mora",        email: "isabel.cabrera@example.com",    country: "España", birthDate: "1993-03-08" },
  { name: "Andrea",      lastName: "Pascual León",        email: "andrea.pascual@example.com",    country: "España", birthDate: "1995-11-30" },
  { name: "Clara",       lastName: "Hidalgo Crespo",      email: "clara.hidalgo@example.com",     country: "España", birthDate: "1984-02-16" },
  { name: "Rocío",       lastName: "Bermúdez Carmona",    email: "rocio.bermudez@example.com",    country: "España", birthDate: "1990-08-22" },
  { name: "Helena",      lastName: "Pardo Lara",          email: "helena.pardo@example.com",      country: "España", birthDate: "1979-05-07" },
  { name: "Miguel Ángel",lastName: "Vidal Castro",        email: "miguel.vidal@example.com",      country: "España", birthDate: "1982-12-14" },
  { name: "Nuria",       lastName: "Estévez Bravo",       email: "nuria.estevez@example.com",     country: "España", birthDate: "1997-04-06" },
];

// ─── Plan de matrículas ──────────────────────────────────────────────────────
// Mapa email → array de nombres de curso. La distribución refleja perfiles:
//  - Mayoría hace "Nutrición consciente" como puerta de entrada
//  - "Plan deportivo" tira de gente joven activa
//  - "Salud hormonal" lo hacen mujeres en la franja 30-50
//  - Algunas alumnas completionistas tienen los 3 cursos
//
// Total: ~35 matrículas. enrolledAt se distribuye en los últimos 6 meses para
// que el listado no salga todo el mismo día.

const COURSE_NOMBRE_PRIMERA   = "Nutrición consciente — fundamentos";
const COURSE_NOMBRE_DEPORTIVO = "Plan deportivo personalizado";
const COURSE_NOMBRE_HORMONAL  = "Salud hormonal en la mujer";

const ENROLLMENT_PLAN = {
  "marta.lopez@example.com":       [{ course: COURSE_NOMBRE_DEPORTIVO, daysAgo:  12 }],
  "laura.fernandez.r@example.com": [{ course: COURSE_NOMBRE_PRIMERA,    daysAgo:  45 },
                                    { course: COURSE_NOMBRE_HORMONAL,   daysAgo:  10 }],
  "carolina.vazquez@example.com":  [{ course: COURSE_NOMBRE_HORMONAL,   daysAgo:  62 },
                                    { course: COURSE_NOMBRE_PRIMERA,    daysAgo:  20 }],
  "beatriz.sanz@example.com":      [{ course: COURSE_NOMBRE_PRIMERA,    daysAgo:  88 }],
  "ana.torres@example.com":        [{ course: COURSE_NOMBRE_HORMONAL,   daysAgo: 105 }],
  "sofia.castro@example.com":      [{ course: COURSE_NOMBRE_DEPORTIVO, daysAgo:  18 }],
  "lucia.ramos@example.com":       [{ course: COURSE_NOMBRE_PRIMERA,    daysAgo: 130 },
                                    { course: COURSE_NOMBRE_HORMONAL,   daysAgo:  75 },
                                    { course: COURSE_NOMBRE_DEPORTIVO, daysAgo:  30 }],
  "elena.ortega@example.com":      [{ course: COURSE_NOMBRE_PRIMERA,    daysAgo:  55 }],
  "cristina.gomez@example.com":    [{ course: COURSE_NOMBRE_DEPORTIVO, daysAgo:  40 }],
  "patricia.jimenez@example.com":  [{ course: COURSE_NOMBRE_HORMONAL,   daysAgo: 160 },
                                    { course: COURSE_NOMBRE_PRIMERA,    daysAgo:  70 }],
  "daniel.alonso@example.com":     [{ course: COURSE_NOMBRE_DEPORTIVO, daysAgo:   8 }],
  "javier.romero@example.com":     [{ course: COURSE_NOMBRE_PRIMERA,    daysAgo: 100 }],
  "pablo.marin@example.com":       [{ course: COURSE_NOMBRE_DEPORTIVO, daysAgo:  22 },
                                    { course: COURSE_NOMBRE_PRIMERA,    daysAgo:  95 }],
  "isabel.cabrera@example.com":    [{ course: COURSE_NOMBRE_PRIMERA,    daysAgo: 145 }],
  "andrea.pascual@example.com":    [{ course: COURSE_NOMBRE_HORMONAL,   daysAgo:  28 }],
  "clara.hidalgo@example.com":     [{ course: COURSE_NOMBRE_PRIMERA,    daysAgo: 175 },
                                    { course: COURSE_NOMBRE_HORMONAL,   daysAgo: 110 },
                                    { course: COURSE_NOMBRE_DEPORTIVO, daysAgo:  60 }],
  "rocio.bermudez@example.com":    [{ course: COURSE_NOMBRE_DEPORTIVO, daysAgo:  35 }],
  "helena.pardo@example.com":      [{ course: COURSE_NOMBRE_PRIMERA,    daysAgo: 120 },
                                    { course: COURSE_NOMBRE_HORMONAL,   daysAgo:  50 }],
  "miguel.vidal@example.com":      [{ course: COURSE_NOMBRE_DEPORTIVO, daysAgo:  85 }],
  "nuria.estevez@example.com":     [{ course: COURSE_NOMBRE_PRIMERA,    daysAgo:  15 }],
};

// ─── Empresas + alumnos B2B (Sección Empresas del overview) ──────────────────
//
// Tres empresas-cliente con perfiles distintos. Sus alumnos tienen
// `type="company"` y `companyId` apuntando a la empresa. La asignación
// de cursos a empresas vive en `CompanyCourse` (qué cursos puede ofrecer
// la empresa a sus empleados).

const COMPANIES = [
  { name: "Gimnasio Bienestar Madrid",  nif: "B81234567", externalId: 9101 },
  { name: "Centro Deportivo Norte",     nif: "B82345678", externalId: 9102 },
  { name: "Clínica de Nutrición Activa", nif: "B83456789", externalId: 9103 },
];

// Cada empresa con los cursos que tiene contratados.
const COMPANY_COURSES = {
  "Gimnasio Bienestar Madrid":   [COURSE_NOMBRE_DEPORTIVO, COURSE_NOMBRE_PRIMERA],
  "Centro Deportivo Norte":      [COURSE_NOMBRE_DEPORTIVO],
  "Clínica de Nutrición Activa": [COURSE_NOMBRE_PRIMERA, COURSE_NOMBRE_HORMONAL],
};

// Alumnos B2B: name + lastName + email + company + cursos en los que están
// matriculados. enrolledAt en los últimos 5 meses.
const B2B_STUDENTS = [
  { name: "Carmen",  lastName: "Ibarra Soler",    email: "carmen.ibarra@bienestar.example",  company: "Gimnasio Bienestar Madrid",  enrollments: [{ course: COURSE_NOMBRE_DEPORTIVO, daysAgo:  42 }] },
  { name: "Iván",    lastName: "Mendoza Prieto",  email: "ivan.mendoza@bienestar.example",   company: "Gimnasio Bienestar Madrid",  enrollments: [{ course: COURSE_NOMBRE_DEPORTIVO, daysAgo:  35 }, { course: COURSE_NOMBRE_PRIMERA, daysAgo: 15 }] },
  { name: "Marina",  lastName: "Salgado Vives",   email: "marina.salgado@deportivonorte.example", company: "Centro Deportivo Norte", enrollments: [{ course: COURSE_NOMBRE_DEPORTIVO, daysAgo:  60 }] },
  { name: "Adrián",  lastName: "Quintana Rey",    email: "adrian.quintana@deportivonorte.example", company: "Centro Deportivo Norte", enrollments: [{ course: COURSE_NOMBRE_DEPORTIVO, daysAgo:  20 }] },
  { name: "Silvia",  lastName: "Aguilar Núñez",   email: "silvia.aguilar@clinicactiva.example", company: "Clínica de Nutrición Activa", enrollments: [{ course: COURSE_NOMBRE_PRIMERA, daysAgo: 70 }, { course: COURSE_NOMBRE_HORMONAL, daysAgo: 28 }] },
  { name: "Raquel",  lastName: "Caballero Roca",  email: "raquel.caballero@clinicactiva.example", company: "Clínica de Nutrición Activa", enrollments: [{ course: COURSE_NOMBRE_HORMONAL, daysAgo: 95 }] },
];

// ─── Quiz attempts (Sección Cuestionarios) ───────────────────────────────────
//
// IDs altos (100_000+) para no colisionar con TutorLMS real si Laura
// conecta WordPress en el futuro. Mezcla de pass/fail. Los wpUserId /
// wpCourseId son de cortesía — la UI los renderiza por studentEmail.

const QUIZ_ATTEMPTS = [
  { wpAttemptId: 100001, quizTitle: "Macronutrientes — test inicial",       courseTitle: COURSE_NOMBRE_PRIMERA,    student: "marta.lopez@example.com",       points: { total: 20, earned: 18, passing: 12, correct: 9, incorrect: 1 }, time: 480, daysAgo: 11, result: "pass" },
  { wpAttemptId: 100002, quizTitle: "Hidratación deportiva",                 courseTitle: COURSE_NOMBRE_DEPORTIVO, student: "sofia.castro@example.com",      points: { total: 15, earned: 12, passing: 10, correct: 8, incorrect: 2 }, time: 360, daysAgo: 17, result: "pass" },
  { wpAttemptId: 100003, quizTitle: "Ciclo menstrual y alimentación",        courseTitle: COURSE_NOMBRE_HORMONAL, student: "patricia.jimenez@example.com",  points: { total: 25, earned: 11, passing: 15, correct: 5, incorrect: 5 }, time: 720, daysAgo: 65, result: "fail" },
  { wpAttemptId: 100004, quizTitle: "Suplementación pre-entreno",            courseTitle: COURSE_NOMBRE_DEPORTIVO, student: "daniel.alonso@example.com",     points: { total: 18, earned: 17, passing: 11, correct: 9, incorrect: 0 }, time: 300, daysAgo:  7, result: "pass" },
  { wpAttemptId: 100005, quizTitle: "Lectura de etiquetas",                  courseTitle: COURSE_NOMBRE_PRIMERA,    student: "beatriz.sanz@example.com",      points: { total: 20, earned: 14, passing: 12, correct: 7, incorrect: 3 }, time: 540, daysAgo: 80, result: "pass" },
  { wpAttemptId: 100006, quizTitle: "Macronutrientes — test inicial",       courseTitle: COURSE_NOMBRE_PRIMERA,    student: "laura.fernandez.r@example.com", points: { total: 20, earned: 20, passing: 12, correct: 10, incorrect: 0 }, time: 410, daysAgo: 40, result: "pass" },
  { wpAttemptId: 100007, quizTitle: "Hidratación deportiva",                 courseTitle: COURSE_NOMBRE_DEPORTIVO, student: "carmen.ibarra@bienestar.example", company: "Gimnasio Bienestar Madrid", points: { total: 15, earned: 9, passing: 10, correct: 6, incorrect: 4 }, time: 480, daysAgo: 38, result: "fail" },
  { wpAttemptId: 100008, quizTitle: "Estrategias nutricionales en menopausia", courseTitle: COURSE_NOMBRE_HORMONAL, student: "silvia.aguilar@clinicactiva.example", company: "Clínica de Nutrición Activa", points: { total: 22, earned: 19, passing: 14, correct: 10, incorrect: 1 }, time: 600, daysAgo: 25, result: "pass" },
  { wpAttemptId: 100009, quizTitle: "Suplementación pre-entreno",            courseTitle: COURSE_NOMBRE_DEPORTIVO, student: "ivan.mendoza@bienestar.example", company: "Gimnasio Bienestar Madrid", points: { total: 18, earned: 16, passing: 11, correct: 8, incorrect: 1 }, time: 350, daysAgo: 30, result: "pass" },
  { wpAttemptId: 100010, quizTitle: "Lectura de etiquetas",                  courseTitle: COURSE_NOMBRE_PRIMERA,    student: "raquel.caballero@clinicactiva.example", company: "Clínica de Nutrición Activa", points: { total: 20, earned: 11, passing: 12, correct: 5, incorrect: 4 }, time: 500, daysAgo: 90, result: "fail" },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write("\n════════════════════════════════════════════\n");
  process.stdout.write(" Nutri Laura — Datos de prueba de Formación \n");
  process.stdout.write("════════════════════════════════════════════\n");

  getMasterDb();
  const { Tenant, TenantModule } = getMasterModels();

  // 1. Tenant + módulo activo
  header("Verificando tenant y módulo training...");
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) {
    process.stderr.write("\n✗ Tenant nutri_laura no encontrado. Ejecuta seed-nutri-laura.js primero.\n");
    process.exit(1);
  }
  const mod = await TenantModule.findOne({ where: { tenantId: tenant.id, moduleKey: "training" } });
  if (!mod || !mod.enabled) {
    process.stderr.write(
      "\n✗ Módulo 'training' no activo. Ejecuta `npm run db:add-training-nutri-laura` primero.\n"
    );
    process.exit(1);
  }
  log(`✓ Tenant ${tenant.name} con módulo training activo`);

  const { models } = getTenantDb(SLUG);
  const { Course, TrainingUser, CourseEnrollment, Company, CompanyCourse, QuizAttempt } = models;

  // 2. Verificar cursos base
  header("Verificando cursos base...");
  const courseNames = [COURSE_NOMBRE_PRIMERA, COURSE_NOMBRE_DEPORTIVO, COURSE_NOMBRE_HORMONAL];
  const courses = {};
  for (const name of courseNames) {
    const c = await Course.findOne({ where: { name } });
    if (!c) {
      process.stderr.write(
        `\n✗ Falta el curso "${name}". Ejecuta primero add-training-module-nutri-laura.js.\n`
      );
      process.exit(1);
    }
    courses[name] = c;
    log(`· ${name}`);
  }

  // 3. Sembrar alumnos privados
  header(`Sembrando ${STUDENTS.length} alumnos privados (B2C)...`);
  const usersByEmail = {};
  let userCreated = 0;
  for (const s of STUDENTS) {
    const email = s.email.toLowerCase().trim();
    const [user, wasCreated] = await TrainingUser.findOrCreate({
      where: { email },
      defaults: {
        email,
        name: s.name,
        lastName: s.lastName,
        type: "private",
        companyId: null,
        country: s.country,
        birthDate: s.birthDate,
        active: true,
      },
    });
    usersByEmail[email] = user;
    if (wasCreated) userCreated++;
  }
  log(`✓ ${userCreated} alumnos creados, ${STUDENTS.length - userCreated} ya existían`);

  // 4. Sembrar matrículas
  header("Sembrando matrículas...");
  let enrolled = 0;
  let skipped = 0;
  for (const [email, items] of Object.entries(ENROLLMENT_PLAN)) {
    const user = usersByEmail[email];
    if (!user) {
      skipped += items.length;
      continue;
    }
    for (const it of items) {
      const course = courses[it.course];
      if (!course) {
        skipped++;
        continue;
      }
      const [, wasCreated] = await CourseEnrollment.findOrCreate({
        where: { trainingUserId: user.id, courseId: course.id },
        defaults: {
          trainingUserId: user.id,
          courseId: course.id,
          companyId: null,
          enrolledAt: daysAgo(it.daysAgo),
          metadata: { source: "seed-nutri-laura-training-data" },
        },
      });
      if (wasCreated) enrolled++;
      else skipped++;
    }
  }
  log(`✓ ${enrolled} matrículas nuevas, ${skipped} ya existían`);

  // 5. Sembrar empresas
  header(`Sembrando ${COMPANIES.length} empresas (B2B)...`);
  const companiesByName = {};
  let companiesCreated = 0;
  for (const c of COMPANIES) {
    const [row, wasCreated] = await Company.findOrCreate({
      where: { name: c.name },
      defaults: { name: c.name, nif: c.nif, externalId: c.externalId, active: true, settings: {} },
    });
    companiesByName[c.name] = row;
    if (wasCreated) companiesCreated++;
  }
  log(`✓ ${companiesCreated} empresas creadas, ${COMPANIES.length - companiesCreated} ya existían`);

  // 6. Asignaciones CompanyCourse
  header("Sembrando asignaciones CompanyCourse...");
  let assignmentsCreated = 0;
  let assignmentsSkipped = 0;
  for (const [companyName, courseNames] of Object.entries(COMPANY_COURSES)) {
    const company = companiesByName[companyName];
    if (!company) { assignmentsSkipped += courseNames.length; continue; }
    for (const courseName of courseNames) {
      const course = courses[courseName];
      if (!course) { assignmentsSkipped++; continue; }
      const [, wasCreated] = await CompanyCourse.findOrCreate({
        where: { companyId: company.id, courseId: course.id },
        defaults: { companyId: company.id, courseId: course.id },
      });
      if (wasCreated) assignmentsCreated++;
      else assignmentsSkipped++;
    }
  }
  log(`✓ ${assignmentsCreated} asignaciones nuevas, ${assignmentsSkipped} ya existían`);

  // 7. Alumnos B2B + matrículas asociadas
  header(`Sembrando ${B2B_STUDENTS.length} alumnos B2B + matrículas...`);
  let b2bUsersCreated = 0;
  let b2bEnrollmentsCreated = 0;
  let b2bEnrollmentsSkipped = 0;
  for (const s of B2B_STUDENTS) {
    const company = companiesByName[s.company];
    if (!company) { continue; }
    const email = s.email.toLowerCase().trim();
    const [user, wasUserCreated] = await TrainingUser.findOrCreate({
      where: { email },
      defaults: {
        email,
        name: s.name,
        lastName: s.lastName,
        type: "company",
        companyId: company.id,
        country: "España",
        active: true,
      },
    });
    // Si el alumno existía pero sin companyId, lo vinculamos.
    if (!wasUserCreated && !user.companyId) {
      await user.update({ companyId: company.id, type: "company" });
    }
    if (wasUserCreated) b2bUsersCreated++;
    for (const it of s.enrollments) {
      const course = courses[it.course];
      if (!course) { b2bEnrollmentsSkipped++; continue; }
      const [, wasCreated] = await CourseEnrollment.findOrCreate({
        where: { trainingUserId: user.id, courseId: course.id },
        defaults: {
          trainingUserId: user.id,
          courseId: course.id,
          companyId: company.id,
          enrolledAt: daysAgo(it.daysAgo),
          metadata: { source: "seed-nutri-laura-training-data:b2b" },
        },
      });
      if (wasCreated) b2bEnrollmentsCreated++;
      else b2bEnrollmentsSkipped++;
    }
  }
  log(`✓ ${b2bUsersCreated} alumnos B2B nuevos, ${b2bEnrollmentsCreated} matrículas B2B nuevas, ${b2bEnrollmentsSkipped} ya existían`);

  // 8. Quiz attempts
  header(`Sembrando ${QUIZ_ATTEMPTS.length} quiz attempts...`);
  let quizCreated = 0;
  let quizSkipped = 0;
  for (const q of QUIZ_ATTEMPTS) {
    const studentEmail = q.student.toLowerCase().trim();
    const user = usersByEmail[studentEmail]
      ?? (await TrainingUser.findOne({ where: { email: studentEmail } }));
    if (!user) { quizSkipped++; continue; }
    const [, wasCreated] = await QuizAttempt.findOrCreate({
      where: { wpAttemptId: q.wpAttemptId },
      defaults: {
        wpAttemptId: q.wpAttemptId,
        wpQuizId: q.wpAttemptId,                // sentinel ficticio
        wpCourseId: q.wpAttemptId % 1000,       // sentinel ficticio
        wpUserId: user.externalUserId ?? q.wpAttemptId,
        studentName: [user.name, user.lastName].filter(Boolean).join(" "),
        studentEmail,
        quizTitle: q.quizTitle,
        courseTitle: q.courseTitle,
        empresa: q.company ?? null,
        attemptDate: daysAgo(q.daysAgo),
        totalQuestions: q.points.correct + q.points.incorrect,
        totalPoints: q.points.total,
        earnedPoints: q.points.earned,
        passingPoints: q.points.passing,
        correctAnswers: q.points.correct,
        incorrectAnswers: q.points.incorrect,
        quizTime: q.time,
        attemptTime: q.time,
        result: q.result,
        answers: [],
      },
    });
    if (wasCreated) quizCreated++;
    else quizSkipped++;
  }
  log(`✓ ${quizCreated} quiz attempts nuevos, ${quizSkipped} ya existían`);

  // 9. Resumen
  const totalUsers = await TrainingUser.count();
  const totalEnrollments = await CourseEnrollment.count();
  const totalCourses = await Course.count();
  const totalCompanies = await Company.count();
  const totalCompanyCourses = await CompanyCourse.count();
  const totalQuizAttempts = await QuizAttempt.count();

  process.stdout.write("\n════════════════════════════════════════════\n");
  process.stdout.write(" Estado final del módulo Formación          \n");
  process.stdout.write("════════════════════════════════════════════\n");
  process.stdout.write(`  Cursos:               ${totalCourses}\n`);
  process.stdout.write(`  Alumnos (B2C + B2B):  ${totalUsers}\n`);
  process.stdout.write(`  Matrículas:           ${totalEnrollments}\n`);
  process.stdout.write(`  Empresas:             ${totalCompanies}\n`);
  process.stdout.write(`  Asignaciones B2B:     ${totalCompanyCourses}\n`);
  process.stdout.write(`  Quiz attempts:        ${totalQuizAttempts}\n`);
  process.stdout.write("════════════════════════════════════════════\n\n");

  await closeAllConnections();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
