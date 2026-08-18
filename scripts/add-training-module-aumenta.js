/**
 * add-training-module-aumenta.js
 *
 * Activa el módulo "training" en el tenant aumenta y lo siembra con datos
 * ficticios para la demo del 9 de junio de 2026.
 *
 * Aumenta es centro de psicopedagogía y desarrollo infantil. Su formación es
 * B2C: las familias de los pacientes (y algunos profesionales externos)
 * compran cursos individualmente. Los 6 cursos son los que aparecen en su web
 * pública. SIN cuestionarios (la tabla `quiz_attempts` queda vacía).
 *
 * Lo que hace:
 *   1. Verifica que el tenant existe y que las tablas de training ya están
 *      creadas en crm_aumenta (lo están desde sync inicial).
 *   2. Registra el módulo `training` en master.tenant_modules con el
 *      interruptor «formación abierta» encendido (featureFlags.formacionAbierta:
 *      la portada base se pinta sin empresas ni cuestionarios ni TutorLMS;
 *      hasta el 18/08/2026 esto era un uiOverride "aumenta/FormacionOverview").
 *   3. Añade "training" al moduleAccess del admin de aumenta.
 *   4. Siembra 6 cursos reales + 15 alumnos privados + ~25 matrículas.
 *
 * Idempotente: re-ejecutar no duplica ni rompe.
 *
 * Uso local:  npm run db:add-training-aumenta
 * Uso VPS:    npm run db:add-training-aumenta:prod
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";

const SLUG = "aumenta";
const ADMIN_EMAIL = "admin@aumenta.es";

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

// ─── Cursos reales de la web de Aumenta ───────────────────────────────────────

const COURSES_DATA = [
  {
    name: "Entender el espectro autista",
    description:
      "Una guía clara y práctica para familias que quieren acompañar a su hijo o hija con TEA con más herramientas y menos miedo.",
  },
  {
    name: "Regulación emocional en la infancia",
    description:
      "Estrategias concretas para acompañar rabietas, frustración y desregulación en niños de 3 a 12 años.",
  },
  {
    name: "Cuidar a quien cuida",
    description:
      "Espacio para familias y profesionales cuidadores. Autocuidado, descanso, redes de apoyo y manejo del agotamiento.",
  },
  {
    name: "Integración sensorial en el aula",
    description:
      "Para profesores y orientadores escolares: cómo detectar dificultades sensoriales y adaptar la dinámica del aula.",
  },
  {
    name: "Primeras palabras y comunicación",
    description:
      "Cómo estimular el lenguaje en niños de 12 a 36 meses. Señales de alarma y juegos de estimulación cotidiana.",
  },
  {
    name: "Entendiendo el TDAH en casa",
    description:
      "Claves para familias de niños con TDAH: organización, deberes, regulación atencional y autoestima académica.",
  },
];

// ─── 15 alumnos B2C ficticios (nombres totalmente inventados) ────────────────

const STUDENTS = [
  {
    email: "marta.rivas@correo.es",
    username: "mrivas",
    name: "Marta",
    lastName: "Rivas Ortega",
    nif: "11223344A",
    birthDate: "1985-04-12",
    country: "ES",
    courses: ["Entender el espectro autista", "Regulación emocional en la infancia"],
    enrolledDaysAgo: 95,
  },
  {
    email: "javier.alonso@correo.es",
    username: "jalonso",
    name: "Javier",
    lastName: "Alonso Núñez",
    nif: "22334455B",
    birthDate: "1982-09-03",
    country: "ES",
    courses: ["Entendiendo el TDAH en casa", "Regulación emocional en la infancia"],
    enrolledDaysAgo: 80,
  },
  {
    email: "cristina.salas@correo.es",
    username: "csalas",
    name: "Cristina",
    lastName: "Salas Vega",
    nif: "33445566C",
    birthDate: "1979-02-21",
    country: "ES",
    courses: ["Integración sensorial en el aula"],
    enrolledDaysAgo: 70,
  },
  {
    email: "beatriz.galan@correo.es",
    username: "bgalan",
    name: "Beatriz",
    lastName: "Galán Sandoval",
    nif: "44556677D",
    birthDate: "1976-11-30",
    country: "ES",
    courses: ["Cuidar a quien cuida"],
    enrolledDaysAgo: 65,
  },
  {
    email: "andres.maestre@correo.es",
    username: "amaestre",
    name: "Andrés",
    lastName: "Maestre Pinilla",
    nif: "55667788E",
    birthDate: "1990-06-17",
    country: "ES",
    courses: ["Primeras palabras y comunicación"],
    enrolledDaysAgo: 55,
  },
  {
    email: "lourdes.carvajal@correo.es",
    username: "lcarvajal",
    name: "Lourdes",
    lastName: "Carvajal Marín",
    nif: "66778899F",
    birthDate: "1983-08-09",
    country: "ES",
    courses: ["Integración sensorial en el aula", "Primeras palabras y comunicación"],
    enrolledDaysAgo: 50,
  },
  {
    email: "tomas.reverte@correo.es",
    username: "treverte",
    name: "Tomás",
    lastName: "Reverte Suárez",
    nif: "77889900G",
    birthDate: "1981-01-14",
    country: "ES",
    courses: ["Entendiendo el TDAH en casa"],
    enrolledDaysAgo: 45,
  },
  {
    email: "mireia.soldevila@correo.es",
    username: "msoldevila",
    name: "Mireia",
    lastName: "Soldevila Bach",
    nif: "88990011H",
    birthDate: "1984-05-22",
    country: "ES",
    courses: ["Cuidar a quien cuida", "Entender el espectro autista"],
    enrolledDaysAgo: 42,
  },
  {
    email: "gonzalo.pizarro@correo.es",
    username: "gpizarro",
    name: "Gonzalo",
    lastName: "Pizarro Aldana",
    nif: "99001122I",
    birthDate: "1986-10-05",
    country: "ES",
    courses: ["Integración sensorial en el aula", "Regulación emocional en la infancia"],
    enrolledDaysAgo: 38,
  },
  {
    email: "sandra.quiroga@correo.es",
    username: "squiroga",
    name: "Sandra",
    lastName: "Quiroga Aymar",
    nif: "10112233J",
    birthDate: "1988-03-28",
    country: "ES",
    courses: ["Entender el espectro autista", "Regulación emocional en la infancia"],
    enrolledDaysAgo: 33,
  },
  {
    email: "eduardo.manjon@correo.es",
    username: "emanjon",
    name: "Eduardo",
    lastName: "Manjón Reseco",
    nif: "11223344K",
    birthDate: "1978-07-19",
    country: "ES",
    courses: ["Entendiendo el TDAH en casa"],
    enrolledDaysAgo: 28,
  },
  {
    email: "carolina.bermejo@correo.es",
    username: "cbermejo",
    name: "Carolina",
    lastName: "Bermejo Roldán",
    nif: "22334455L",
    birthDate: "1962-12-10",
    country: "ES",
    courses: ["Cuidar a quien cuida"],
    enrolledDaysAgo: 24,
  },
  {
    email: "roberto.calzada@correo.es",
    username: "rcalzada",
    name: "Roberto",
    lastName: "Calzada Penedo",
    nif: "33445566M",
    birthDate: "1980-04-04",
    country: "ES",
    courses: ["Integración sensorial en el aula", "Entendiendo el TDAH en casa"],
    enrolledDaysAgo: 18,
  },
  {
    email: "inmaculada.doblas@correo.es",
    username: "idoblas",
    name: "Inmaculada",
    lastName: "Doblas Rivero",
    nif: "44556677N",
    birthDate: "1987-09-16",
    country: "ES",
    courses: ["Entender el espectro autista"],
    enrolledDaysAgo: 12,
  },
  {
    email: "daniel.esparrago@correo.es",
    username: "desparrago",
    name: "Daniel",
    lastName: "Espárrago Bujalance",
    nif: "55667788O",
    birthDate: "1991-02-08",
    country: "ES",
    courses: ["Primeras palabras y comunicación"],
    enrolledDaysAgo: 5,
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" Aumenta — Activar módulo Formación     \n");
  process.stdout.write("════════════════════════════════════════\n");

  getMasterDb();
  const { Tenant, User, TenantModule } = getMasterModels();

  // ── 1. Verificar tenant ─────────────────────────────────────────────────
  header("Verificando tenant aumenta...");
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) {
    process.stderr.write("\n✗ Tenant aumenta no encontrado.\n");
    process.exit(1);
  }
  log(`✓ Tenant encontrado: ${tenant.name} (id: ${tenant.id})`);

  // Las tablas de training en crm_aumenta ya existen desde el sync inicial:
  // companies, courses, company_courses, training_users, course_enrollments,
  // quiz_attempts. La de quiz_attempts NO se usa: el seed no crea filas y la
  // portada, en «formación abierta», no enseña la sección Cuestionarios.

  // ── 2. Registrar módulo training ────────────────────────────────────────
  header("Registrando módulo training en master.tenant_modules...");
  const [moduleRow, modCreated] = await TenantModule.findOrCreate({
    where: { tenantId: tenant.id, moduleKey: "training" },
    defaults: {
      tenantId: tenant.id,
      moduleKey: "training",
      enabled: true,
      version: "1.0.0",
      // Sin pantalla propia desde el 18/08/2026: la portada base sabe pintarse
      // «abierta» y lo decide el interruptor de abajo (lib/training/formacionAbierta.js).
      uiOverride: null,
      schemaExtensions: {},
      logicOverrides: {
        // Indicadores históricos (junio 2026). NO los lee nadie: la portada
        // lee featureFlags.formacionAbierta. Se conservan porque ya están así
        // en producción y quitarlos aquí no los quitaría de allí.
        b2bEnabled: false,
        quizzesEnabled: false,
        tutorlmsConnected: false,
      },
      featureFlags: { formacionAbierta: true },
    },
  });

  if (!modCreated) {
    await moduleRow.update({
      enabled: true,
      uiOverride: null,
      logicOverrides: {
        b2bEnabled: false,
        quizzesEnabled: false,
        tutorlmsConnected: false,
      },
      featureFlags: { ...(moduleRow.featureFlags ?? {}), formacionAbierta: true },
    });
    log("· Módulo ya existía — actualizado (formación abierta encendida, sin pantalla propia)");
  } else {
    log("✓ Módulo training creado con formación abierta encendida (sin pantalla propia)");
  }

  // ── 3. moduleAccess del admin ───────────────────────────────────────────
  header("Actualizando moduleAccess del admin...");
  const admin = await User.findOne({ where: { email: ADMIN_EMAIL } });
  if (!admin) {
    process.stderr.write(`\n✗ Usuario ${ADMIN_EMAIL} no encontrado.\n`);
    process.exit(1);
  }
  const currentAccess = admin.moduleAccess ?? [];
  if (!currentAccess.includes("training")) {
    await admin.update({ moduleAccess: [...currentAccess, "training"] });
    log(`✓ "training" añadido a moduleAccess de ${ADMIN_EMAIL}`);
  } else {
    log(`· ${ADMIN_EMAIL} ya tenía acceso a training`);
  }

  // ── 4. Cargar modelos del tenant ────────────────────────────────────────
  const { models } = getTenantDb(SLUG);
  const { Course, TrainingUser, CourseEnrollment } = models;

  // ── 5. Sembrar cursos ───────────────────────────────────────────────────
  header(`Sembrando ${COURSES_DATA.length} cursos de Aumenta...`);
  const courseMap = {};
  for (const c of COURSES_DATA) {
    const [course, created] = await Course.findOrCreate({
      where: { name: c.name },
      defaults: { name: c.name, active: true },
    });
    courseMap[c.name] = course;
    log(`${created ? "✓" : "·"} ${c.name}`);
  }

  // ── 6. Sembrar alumnos + matrículas ─────────────────────────────────────
  header(`Sembrando ${STUDENTS.length} alumnos (B2C) + matrículas...`);
  let usersCreated = 0;
  let enrollmentsCreated = 0;
  for (const s of STUDENTS) {
    const [user, uCreated] = await TrainingUser.findOrCreate({
      where: { email: s.email },
      defaults: {
        companyId: null,
        type: "private",
        username: s.username,
        email: s.email,
        name: s.name,
        lastName: s.lastName,
        nif: s.nif,
        birthDate: s.birthDate,
        country: s.country,
        active: true,
      },
    });
    if (uCreated) usersCreated++;

    for (const courseName of s.courses) {
      const course = courseMap[courseName];
      const enrolledAt = daysAgo(s.enrolledDaysAgo);
      const [, eCreated] = await CourseEnrollment.findOrCreate({
        where: { trainingUserId: user.id, courseId: course.id },
        defaults: {
          companyId: null,
          enrolledAt,
          metadata: {},
        },
      });
      if (eCreated) enrollmentsCreated++;
    }
  }
  log(`✓ ${usersCreated} alumnos creados`);
  log(`✓ ${enrollmentsCreated} matrículas creadas`);

  // ── 7. Resumen ──────────────────────────────────────────────────────────
  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" ¡Listo!\n");
  process.stdout.write("════════════════════════════════════════\n");
  process.stdout.write(`  Cursos:           ${COURSES_DATA.length}\n`);
  process.stdout.write(`  Alumnos:          ${STUDENTS.length} (todos B2C, sin empresa)\n`);
  process.stdout.write(`  Matrículas:       ${STUDENTS.reduce((s, u) => s + u.courses.length, 0)}\n`);
  process.stdout.write(`  Cuenta admin:     ${ADMIN_EMAIL}\n`);
  process.stdout.write(`  Portada:          formación abierta (featureFlags.formacionAbierta), sin pantalla propia\n`);
  process.stdout.write(`  Cuestionarios:    DESACTIVADOS (sin datos, sección oculta en UI)\n`);
  process.stdout.write("════════════════════════════════════════\n\n");

  await closeAllConnections();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
