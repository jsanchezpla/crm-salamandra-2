/**
 * seed-nutri-laura-training-data.js
 *
 * Llena el módulo Formación de nutri_laura con datos de prueba realistas:
 *   - 20 alumnos privados (B2C) con perfiles variados de nutrición
 *   - ~35 matrículas distribuidas entre los 3 cursos existentes
 *
 * Asume que el módulo ya está activo y los 3 cursos base existen
 * (los crea `scripts/add-training-module-nutri-laura.js`). Si no es así,
 * el script aborta con un mensaje claro.
 *
 * Idempotente:
 *   - `TrainingUser.email` tiene UNIQUE → findOrCreate por email.
 *   - `CourseEnrollment.(trainingUserId, courseId)` tiene UNIQUE → findOrCreate.
 * Re-ejecutar no crea duplicados.
 *
 * El override de UI de nutri_laura solo muestra Cursos / Alumnos / Matrículas
 * (B2C). No se siembran empresas, asignaciones B2B ni quiz attempts.
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
  const { Course, TrainingUser, CourseEnrollment } = models;

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

  // 5. Resumen
  const totalUsers = await TrainingUser.count();
  const totalEnrollments = await CourseEnrollment.count();
  const totalCourses = await Course.count();

  process.stdout.write("\n════════════════════════════════════════════\n");
  process.stdout.write(" Estado final del módulo Formación          \n");
  process.stdout.write("════════════════════════════════════════════\n");
  process.stdout.write(`  Cursos:        ${totalCourses}\n`);
  process.stdout.write(`  Alumnos:       ${totalUsers}\n`);
  process.stdout.write(`  Matrículas:    ${totalEnrollments}\n`);
  process.stdout.write("════════════════════════════════════════════\n\n");

  await closeAllConnections();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
