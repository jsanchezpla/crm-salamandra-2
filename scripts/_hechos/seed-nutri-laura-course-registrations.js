/**
 * seed-nutri-laura-course-registrations.js
 *
 * Siembra registros de curso (`course_registrations`) para nutri_laura con
 * perfiles nutricionales realistas. Misma tabla que usa Retorika para el
 * sprint "Liderazgo Educativo" pero con copy adaptado a nutrición:
 *   - centerData: gimnasios, clínicas, consultas privadas.
 *   - teacherData: perfil profesional (entrenadores, nutricionistas en
 *     formación, profesores de yoga, monitores de fitness).
 *   - diagnosisData: motivación, nivel de estrés, hábitos alimentarios.
 *
 * Se distribuyen 6 registros entre los 3 cursos que ya existen en
 * crm_nutri_laura.courses (2 en cada uno).
 *
 * Idempotente:
 *   - Clave (email, wpProductId) replicada con findOrCreate. Misma
 *     idempotencia que aplica el endpoint público POST /registro-curso.
 *   - wpProductId asignado en rango 200001+ para no colisionar con
 *     productos Woo reales si Laura conecta WordPress en el futuro.
 *
 * Asume que add-training-module-nutri-laura.js ya ejecutó (los 3 cursos
 * deben existir). Si no, aborta.
 *
 * Uso local:  node --env-file=.env.local scripts/seed-nutri-laura-course-registrations.js
 * Uso VPS:    docker compose exec app node scripts/seed-nutri-laura-course-registrations.js
 */

import { getMasterDb, getMasterModels } from "../../lib/db/masterDb.js";
import { getTenantDb, closeAllConnections } from "../../lib/db/tenantDb.js";

const SLUG = "nutri_laura";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

// ─── Cursos a los que se vincularán los registros ───────────────────────────

const COURSE_NOMBRE_PRIMERA   = "Nutrición consciente — fundamentos";
const COURSE_NOMBRE_DEPORTIVO = "Plan deportivo personalizado";
const COURSE_NOMBRE_HORMONAL  = "Salud hormonal en la mujer";

// ─── Catálogo de registros ──────────────────────────────────────────────────
//
// Cada registro = un candidato que rellenó el formulario inicial antes de
// matricularse. El backend ya valida que cada email+wpProductId solo aparezca
// una vez; aquí lo respetamos para idempotencia.

const REGISTRATIONS = [
  // ── Curso "Nutrición consciente — fundamentos" ─────────────────────────────
  {
    wpProductId: 200001,
    courseName: COURSE_NOMBRE_PRIMERA,
    daysAgo: 18,
    email: "raul.barrios@centrofitlife.example",
    centerName: "Centro Fit Life Madrid",
    centerNif: "B85123456",
    centerData: {
      type: "gimnasio",
      name: "Centro Fit Life Madrid",
      address: { street: "C/ Alberto Aguilera 47", city: "Madrid", state: "Madrid", postalCode: "28015", country: "ES" },
      nif: "B85123456",
    },
    teacherData: {
      yearsOfExperience: 5,
      positions: ["Entrenador personal", "Coordinador de sala"],
      coursesTeaching: ["HIIT", "Fuerza funcional"],
      subjects: ["Acondicionamiento físico", "Movilidad"],
      topicsOfInterest: ["Nutrición deportiva", "Pérdida de grasa", "Recomposición corporal"],
    },
    diagnosisData: {
      motivationCurrent: 8,
      motivationVsStart: 7,
      centerEnvironment: "positivo",
      stressLevel: 3,
      eatingHabits: "irregular",
      goals: "Mejorar el rendimiento de mis clientes y ofrecer planes nutricionales serios",
    },
  },
  {
    wpProductId: 200002,
    courseName: COURSE_NOMBRE_PRIMERA,
    daysAgo: 32,
    email: "noelia.serrano@consultanutri.example",
    centerName: "Consulta Nutri Saludable",
    centerNif: "12345678Z",
    centerData: {
      type: "consulta particular",
      name: "Consulta Nutri Saludable",
      address: { street: "Av. del Mediterráneo 142", city: "Valencia", state: "Valencia", postalCode: "46023", country: "ES" },
      nif: "12345678Z",
    },
    teacherData: {
      yearsOfExperience: 2,
      positions: ["Dietista-nutricionista junior"],
      coursesTeaching: [],
      subjects: ["Alimentación familiar", "Educación nutricional"],
      topicsOfInterest: ["Mindful eating", "Alimentación intuitiva", "Trastornos de conducta alimentaria"],
    },
    diagnosisData: {
      motivationCurrent: 9,
      motivationVsStart: 8,
      centerEnvironment: "estable",
      stressLevel: 5,
      eatingHabits: "estructurada",
      goals: "Profundizar en herramientas de coaching nutricional",
    },
  },

  // ── Curso "Plan deportivo personalizado" ──────────────────────────────────
  {
    wpProductId: 200003,
    courseName: COURSE_NOMBRE_DEPORTIVO,
    daysAgo: 9,
    email: "ivan.peralta@crossfitnortemadrid.example",
    centerName: "CrossFit Norte Madrid",
    centerNif: "B85987654",
    centerData: {
      type: "box CrossFit",
      name: "CrossFit Norte Madrid",
      address: { street: "C/ Sinesio Delgado 12", city: "Madrid", state: "Madrid", postalCode: "28029", country: "ES" },
      nif: "B85987654",
    },
    teacherData: {
      yearsOfExperience: 7,
      positions: ["Head coach", "L2 trainer"],
      coursesTeaching: ["Halterofilia básica", "WOD scaling"],
      subjects: ["Periodización del entrenamiento", "Recuperación deportiva"],
      topicsOfInterest: ["Suplementación deportiva", "Timing de macronutrientes", "Carbohidratos cíclicos"],
    },
    diagnosisData: {
      motivationCurrent: 10,
      motivationVsStart: 10,
      centerEnvironment: "muy positivo",
      stressLevel: 2,
      eatingHabits: "estricta",
      goals: "Diseñar planes nutricionales para atletas en competición",
    },
  },
  {
    wpProductId: 200004,
    courseName: COURSE_NOMBRE_DEPORTIVO,
    daysAgo: 48,
    email: "claudia.molina@studiopilatesbcn.example",
    centerName: "Studio Pilates Barcelona",
    centerNif: "B62112233",
    centerData: {
      type: "estudio",
      name: "Studio Pilates Barcelona",
      address: { street: "C/ Roselló 215", city: "Barcelona", state: "Barcelona", postalCode: "08008", country: "ES" },
      nif: "B62112233",
    },
    teacherData: {
      yearsOfExperience: 4,
      positions: ["Instructora de Pilates", "Coordinadora de bienestar"],
      coursesTeaching: ["Pilates terapéutico", "Pilates para embarazadas"],
      subjects: ["Mecánica corporal", "Respiración"],
      topicsOfInterest: ["Alimentación antiinflamatoria", "Hidratación", "Nutrición para deporte de bajo impacto"],
    },
    diagnosisData: {
      motivationCurrent: 7,
      motivationVsStart: 6,
      centerEnvironment: "estable",
      stressLevel: 4,
      eatingHabits: "consciente",
      goals: "Complementar mis sesiones con asesoramiento nutricional",
    },
  },

  // ── Curso "Salud hormonal en la mujer" ────────────────────────────────────
  {
    wpProductId: 200005,
    courseName: COURSE_NOMBRE_HORMONAL,
    daysAgo: 22,
    email: "patricia.ortega@clinicasaludhormonal.example",
    centerName: "Clínica Salud Hormonal Sevilla",
    centerNif: "B41555888",
    centerData: {
      type: "clínica",
      name: "Clínica Salud Hormonal Sevilla",
      address: { street: "Av. Eduardo Dato 35", city: "Sevilla", state: "Sevilla", postalCode: "41005", country: "ES" },
      nif: "B41555888",
    },
    teacherData: {
      yearsOfExperience: 10,
      positions: ["Ginecóloga", "Coordinadora de salud femenina"],
      coursesTeaching: ["Salud hormonal postparto", "Menopausia y bienestar"],
      subjects: ["Endocrinología", "Salud reproductiva"],
      topicsOfInterest: ["Resistencia a la insulina", "SOP y nutrición", "Microbiota y hormonas"],
    },
    diagnosisData: {
      motivationCurrent: 9,
      motivationVsStart: 9,
      centerEnvironment: "muy positivo",
      stressLevel: 4,
      eatingHabits: "balanceada",
      goals: "Integrar pautas nutricionales en consultas ginecológicas",
    },
  },
  {
    wpProductId: 200006,
    courseName: COURSE_NOMBRE_HORMONAL,
    daysAgo: 75,
    email: "alba.benitez@yogaequilibrio.example",
    centerName: "Yoga Equilibrio",
    centerNif: "29876543K",
    centerData: {
      type: "centro de yoga",
      name: "Yoga Equilibrio",
      address: { street: "Pl. Ricardo de Orueta 4", city: "Granada", state: "Granada", postalCode: "18004", country: "ES" },
      nif: "29876543K",
    },
    teacherData: {
      yearsOfExperience: 6,
      positions: ["Profesora de yoga hormonal", "Terapeuta ayurvédica"],
      coursesTeaching: ["Yoga hormonal", "Yoga para menopausia"],
      subjects: ["Bienestar integral", "Cuerpo-mente"],
      topicsOfInterest: ["Ayurveda y nutrición", "Ciclo menstrual y comida", "Adaptógenos"],
    },
    diagnosisData: {
      motivationCurrent: 8,
      motivationVsStart: 7,
      centerEnvironment: "positivo",
      stressLevel: 3,
      eatingHabits: "vegetariana",
      goals: "Aprender pautas para acompañar a mis alumnas en sus ciclos hormonales",
    },
  },
];

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════════════\n");
  process.stdout.write(" Nutri Laura — Registros de curso (course_registrations)  \n");
  process.stdout.write("══════════════════════════════════════════════════════════\n");

  getMasterDb();
  const { Tenant, TenantModule } = getMasterModels();

  // 1. Tenant + módulo
  header("Verificando tenant y módulo training...");
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) {
    process.stderr.write("\n✗ Tenant nutri_laura no encontrado.\n");
    process.exit(1);
  }
  const mod = await TenantModule.findOne({ where: { tenantId: tenant.id, moduleKey: "training" } });
  if (!mod || !mod.enabled) {
    process.stderr.write("\n✗ Módulo 'training' no activo.\n");
    process.exit(1);
  }
  log(`✓ Tenant ${tenant.name} con módulo training activo`);

  const { models } = getTenantDb(SLUG);
  const { Course, TrainingUser, CourseRegistration } = models;

  // 2. Verificar cursos base
  header("Verificando cursos base...");
  const courseNames = [COURSE_NOMBRE_PRIMERA, COURSE_NOMBRE_DEPORTIVO, COURSE_NOMBRE_HORMONAL];
  const courses = {};
  for (const name of courseNames) {
    const c = await Course.findOne({ where: { name } });
    if (!c) {
      process.stderr.write(`\n✗ Falta el curso "${name}". Ejecuta add-training-module-nutri-laura.js.\n`);
      process.exit(1);
    }
    courses[name] = c;
    log(`· ${name}${c.wpCourseId ? ` (wpCourseId=${c.wpCourseId})` : ""}`);
  }

  // 3. Sembrar registros
  header(`Sembrando ${REGISTRATIONS.length} registros de curso...`);
  let created = 0;
  let existed = 0;
  for (const r of REGISTRATIONS) {
    const course = courses[r.courseName];
    if (!course) { existed++; continue; }
    const wpCourseId = course.wpCourseId ?? r.wpProductId;  // sentinel si el curso no tiene wp id
    const email = r.email.toLowerCase().trim();

    // Find-or-create TrainingUser para el registro (auto-vinculación
    // como hace el endpoint público real).
    const [user] = await TrainingUser.findOrCreate({
      where: { email },
      defaults: {
        email,
        name: r.teacherData.positions?.[0] ?? "Candidato",
        type: "private",
        active: true,
      },
    });

    const [, wasCreated] = await CourseRegistration.findOrCreate({
      where: { email, wpProductId: r.wpProductId },
      defaults: {
        trainingUserId: user.id,
        courseId: course.id,
        companyId: null,
        email,
        wpUserId: null,
        wpProductId: r.wpProductId,
        wpCourseId,
        submittedAt: daysAgo(r.daysAgo),
        centerNif: r.centerNif ?? null,
        centerName: r.centerName,
        centerData: r.centerData,
        teacherData: r.teacherData,
        diagnosisData: r.diagnosisData,
        rawPayload: {
          source: "seed-nutri-laura-course-registrations",
          ...r,
        },
      },
    });
    if (wasCreated) created++;
    else existed++;
  }
  log(`✓ ${created} registros nuevos, ${existed} ya existían`);

  // 4. Resumen
  const totalRegs = await CourseRegistration.count();
  process.stdout.write("\n══════════════════════════════════════════════════════════\n");
  process.stdout.write(" Estado final                                             \n");
  process.stdout.write("══════════════════════════════════════════════════════════\n");
  process.stdout.write(`  Registros totales en course_registrations: ${totalRegs}\n`);
  process.stdout.write("══════════════════════════════════════════════════════════\n\n");

  await closeAllConnections();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
