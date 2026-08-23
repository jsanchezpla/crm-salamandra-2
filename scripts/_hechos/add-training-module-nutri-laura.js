/**
 * add-training-module-nutri-laura.js
 *
 * Activa el módulo "training" en el tenant nutri_laura:
 *
 * 1. Crea las 6 tablas de formación en `crm_nutri_laura` (companies,
 *    courses, company_courses, training_users, course_enrollments,
 *    quiz_attempts) con SQL crudo. Patrón idéntico al
 *    `add-leads-module-nutri-laura.js`: el tenant arrancó minimal con
 *    solo citas, y vamos añadiendo tablas a medida que activamos
 *    módulos.
 *
 *    NOTA: el modelo legacy `Training` (tabla `trainings`) no se crea.
 *    Según docs/modules/training.md está marcado para borrado y ningún
 *    flujo lo usa.
 *
 * 2. Registra el módulo `training` en `master.tenant_modules` sin
 *    `uiOverride` — Laura usa el overview default (igual que retorika).
 *    El override antiguo B2C se eliminó por petición de Laura.
 * 3. Añade "training" al `moduleAccess` del admin (admin@nutri-laura.es).
 * 4. Siembra 3 cursos de nutrición de ejemplo. Aún sin alumnos ni
 *    matrículas — esos vendrán cuando Laura conecte su WordPress +
 *    TutorLMS o los demos a mano.
 *
 * B2C / B2B: Laura arranca solo con alumnos privados (B2C), pero las
 * tablas `companies` y `company_courses` se crean igual para soportar
 * B2B en el futuro sin migración adicional.
 *
 * TODO cuando Laura conecte su WordPress + TutorLMS:
 *  - El helper `lib/training/webhookAuth.js` lee un único secret
 *    `RETORIKA_WEBHOOK_SECRET`. Hay que extenderlo a secret por-tenant
 *    para no compartir el mismo HMAC entre Retorika y nutri_laura.
 *  - Configurar el plugin WP de Laura con el endpoint del CRM y el
 *    `x-tenant: nutri_laura` header.
 *
 * Idempotente: re-ejecutar no rompe nada ni genera duplicados.
 *
 * Uso local:  npm run db:add-training-nutri-laura
 * Uso VPS:    npm run db:add-training-nutri-laura:prod
 */

import { Sequelize } from "sequelize";
import { getMasterDb, getMasterModels } from "../../lib/db/masterDb.js";
import { getTenantDb, closeAllConnections } from "../../lib/db/tenantDb.js";

const SLUG = "nutri_laura";
const SCHEMA = `crm_${SLUG}`;
const ADMIN_EMAIL = "admin@nutri-laura.es";

function log(msg) {
  process.stdout.write(`  ${msg}\n`);
}
function header(msg) {
  process.stdout.write(`\n▶ ${msg}\n`);
}

// ─── Cursos de nutrición de ejemplo ───────────────────────────────────────────

const COURSES_DATA = [
  {
    name: "Nutrición consciente — fundamentos",
    description:
      "Bases de una alimentación equilibrada y sostenible. Macronutrientes, etiquetado, planificación semanal.",
  },
  {
    name: "Plan deportivo personalizado",
    description: "Nutrición orientada al rendimiento y la recuperación para atletas amateur.",
  },
  {
    name: "Salud hormonal en la mujer",
    description: "Alimentación enfocada al ciclo, perimenopausia y equilibrio hormonal.",
  },
];

// ─── Creación de tablas con SQL crudo ────────────────────────────────────────

async function ensureEnum(rawDb, schema, name, values) {
  const enumExistsSql = `SELECT 1 FROM pg_type tp
    JOIN pg_namespace n ON n.oid = tp.typnamespace
    WHERE tp.typname = $1 AND n.nspname = $2`;
  const [rows] = await rawDb.query(enumExistsSql, { bind: [name, schema] });
  if (rows.length === 0) {
    const valuesSql = values.map((v) => `'${v}'`).join(",");
    await rawDb.query(`CREATE TYPE "${schema}"."${name}" AS ENUM (${valuesSql})`);
    log(`  ✓ enum ${name}: creado`);
  } else {
    log(`  · enum ${name}: ya existe`);
  }
}

async function createTrainingTablesIfNotExist(rawDb, schema) {
  // ── Enums ───────────────────────────────────────────────────────────────────
  await ensureEnum(rawDb, schema, "enum_training_users_type", ["private", "company"]);
  await ensureEnum(rawDb, schema, "enum_quiz_attempts_result", ["pass", "fail"]);

  // ── companies ───────────────────────────────────────────────────────────────
  await rawDb.query(`
    CREATE TABLE IF NOT EXISTS "${schema}"."companies" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      external_id INTEGER,
      active BOOLEAN DEFAULT TRUE,
      settings JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  log(`  ✓ tabla companies`);

  // ── courses ─────────────────────────────────────────────────────────────────
  await rawDb.query(`
    CREATE TABLE IF NOT EXISTS "${schema}"."courses" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      wp_course_id INTEGER,
      wc_product_id INTEGER,
      name VARCHAR(255) NOT NULL,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  log(`  ✓ tabla courses`);

  // ── company_courses (pivot) ─────────────────────────────────────────────────
  await rawDb.query(`
    CREATE TABLE IF NOT EXISTS "${schema}"."company_courses" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID NOT NULL REFERENCES "${schema}"."companies"(id) ON DELETE CASCADE,
      course_id UUID NOT NULL REFERENCES "${schema}"."courses"(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await rawDb.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS "company_courses_company_course_unique"
      ON "${schema}"."company_courses" (company_id, course_id)`
  );
  log(`  ✓ tabla company_courses`);

  // ── training_users ──────────────────────────────────────────────────────────
  await rawDb.query(`
    CREATE TABLE IF NOT EXISTS "${schema}"."training_users" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID REFERENCES "${schema}"."companies"(id) ON DELETE SET NULL,
      external_user_id INTEGER,
      type "${schema}"."enum_training_users_type" NOT NULL DEFAULT 'private',
      username VARCHAR(255),
      email VARCHAR(255) NOT NULL,
      name VARCHAR(255),
      last_name VARCHAR(255),
      birth_date DATE,
      country VARCHAR(255),
      nif VARCHAR(255),
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await rawDb.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS "training_users_email_unique"
      ON "${schema}"."training_users" (email)`
  );
  log(`  ✓ tabla training_users`);

  // ── course_enrollments ──────────────────────────────────────────────────────
  await rawDb.query(`
    CREATE TABLE IF NOT EXISTS "${schema}"."course_enrollments" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      training_user_id UUID NOT NULL REFERENCES "${schema}"."training_users"(id) ON DELETE CASCADE,
      course_id UUID NOT NULL REFERENCES "${schema}"."courses"(id) ON DELETE CASCADE,
      company_id UUID REFERENCES "${schema}"."companies"(id) ON DELETE SET NULL,
      enrolled_at TIMESTAMPTZ DEFAULT now(),
      external_registration_id INTEGER,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await rawDb.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS "course_enrollments_user_course_unique"
      ON "${schema}"."course_enrollments" (training_user_id, course_id)`
  );
  log(`  ✓ tabla course_enrollments`);

  // ── quiz_attempts ───────────────────────────────────────────────────────────
  await rawDb.query(`
    CREATE TABLE IF NOT EXISTS "${schema}"."quiz_attempts" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      wp_attempt_id INTEGER NOT NULL UNIQUE,
      wp_quiz_id INTEGER NOT NULL,
      wp_course_id INTEGER NOT NULL,
      wp_user_id INTEGER NOT NULL,
      student_name VARCHAR(255),
      student_email VARCHAR(255),
      quiz_title VARCHAR(255),
      course_title VARCHAR(255),
      empresa VARCHAR(255),
      attempt_date TIMESTAMPTZ,
      total_questions INTEGER,
      total_points DECIMAL(10,2),
      earned_points DECIMAL(10,2),
      passing_points DECIMAL(10,2),
      correct_answers INTEGER,
      incorrect_answers INTEGER,
      quiz_time INTEGER,
      attempt_time INTEGER,
      result "${schema}"."enum_quiz_attempts_result",
      answers JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  log(`  ✓ tabla quiz_attempts`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" Nutri Laura — Activar módulo Formación \n");
  process.stdout.write("════════════════════════════════════════\n");

  getMasterDb();
  const { Tenant, User, TenantModule } = getMasterModels();

  // ── 1. Verificar tenant ───────────────────────────────────────────────────
  header("Verificando tenant nutri_laura...");
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) {
    process.stderr.write(
      "\n✗ Tenant nutri_laura no encontrado. Ejecuta `npm run db:seed:nutri-laura` primero.\n"
    );
    process.exit(1);
  }
  log(`✓ Tenant encontrado: ${tenant.name} (id: ${tenant.id})`);

  // ── 2. Crear tablas con SQL crudo ─────────────────────────────────────────
  header(`Creando tablas de formación en ${SCHEMA}...`);
  const rawDb = new Sequelize(process.env.DATABASE_URL, {
    dialect: "postgres",
    logging: false,
  });
  await createTrainingTablesIfNotExist(rawDb, SCHEMA);
  await rawDb.close();

  // Cargar modelos del tenant (sin sync) para el seed
  const { models } = getTenantDb(SLUG);
  const { Course } = models;

  // ── 3. Registrar módulo training ──────────────────────────────────────────
  header("Registrando módulo training en master.tenant_modules...");
  const [moduleRow, modCreated] = await TenantModule.findOrCreate({
    where: { tenantId: tenant.id, moduleKey: "training" },
    defaults: {
      tenantId: tenant.id,
      moduleKey: "training",
      enabled: true,
      version: "1.0.0",
      uiOverride: null,
      schemaExtensions: {},
      logicOverrides: {
        // Indicadores leídos por el override de UI. No tienen efecto en el
        // backend; sirven para que el front decida qué secciones pintar.
        b2bEnabled: false,
        tutorlmsConnected: false,
      },
      featureFlags: {},
    },
  });

  if (!modCreated) {
    await moduleRow.update({ enabled: true, uiOverride: null });
    log("· Módulo ya existía — actualizado");
  } else {
    log("✓ Módulo training creado con uiOverride: nutri-laura/FormacionOverview");
  }

  // ── 4. moduleAccess del admin ─────────────────────────────────────────────
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

  // ── 5. Sembrar cursos de ejemplo ──────────────────────────────────────────
  header(`Sembrando ${COURSES_DATA.length} cursos de nutrición...`);
  let created = 0;
  for (const c of COURSES_DATA) {
    const [, wasCreated] = await Course.findOrCreate({
      where: { name: c.name },
      defaults: { name: c.name, active: true },
    });
    if (wasCreated) created++;
  }
  log(`✓ ${created} cursos creados, ${COURSES_DATA.length - created} ya existían`);

  // ── 6. Resumen ────────────────────────────────────────────────────────────
  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" ¡Listo!                                \n");
  process.stdout.write("════════════════════════════════════════\n");
  process.stdout.write(`  Cursos en crm_${SLUG}:    ${COURSES_DATA.length}\n`);
  process.stdout.write(`  Cuenta admin:               ${ADMIN_EMAIL}\n`);
  process.stdout.write(`  uiOverride:                 nutri-laura/FormacionOverview\n`);
  process.stdout.write("────────────────────────────────────────\n");
  process.stdout.write(" Pendiente cuando Laura conecte WP+TutorLMS:\n");
  process.stdout.write("  · Configurar webhook secret por-tenant\n");
  process.stdout.write("    (hoy lib/training/webhookAuth.js usa\n");
  process.stdout.write("    un único RETORIKA_WEBHOOK_SECRET).\n");
  process.stdout.write("════════════════════════════════════════\n\n");

  await closeAllConnections();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
