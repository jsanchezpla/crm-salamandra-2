/**
 * setup-retorika-tenant-local.js
 *
 * Inicializa el tenant `retorika` en LOCAL desde cero — sin tocar producción.
 * Crea master.tenants row, schema crm_retorika, todas las tablas del modelo
 * (vía sequelize.sync), módulo training, usuario admin y datos mínimos
 * (1 curso, 1 empresa "Trinity College", 2 alumnos de prueba) para poder
 * smoke-testear el sprint "Registros previos al curso".
 *
 * IDEMPOTENTE. Re-ejecutar no duplica nada ni rompe ningún registro existente.
 *
 * AISLAMIENTO PRODUCCIÓN:
 *   - Aborta inmediatamente si NODE_ENV === "production".
 *   - El script SOLO se expone vía `npm run setup:retorika-local` que carga
 *     .env.local (no .env.production). No existe variante `:prod`.
 *
 * Uso:
 *   npm run setup:retorika-local
 *
 * Después de ejecutarlo, en orden:
 *   1. npm run db:migrate:course-registrations
 *   2. Reiniciar dev server (Ctrl+C → npm run dev)
 *   3. Smoke 5 tests HTTP contra el dev server
 */

import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { Sequelize } from "sequelize";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";

const SLUG = "retorika";
const SCHEMA = `crm_${SLUG}`;
const ADMIN_EMAIL = "admin@retorika.es";

// NIF placeholder local — el NIF real entra al importar en producción.
const TRINITY_NIF = "A12345678";

const PRIMARY_COLOR = "#234182"; // azul corporativo retorika

function log(step, msg) {
  process.stdout.write(`  [setup:retorika] paso ${step}: ${msg}\n`);
}
function header(msg) {
  process.stdout.write(`\n▶ ${msg}\n`);
}
function abort(msg, code = 1) {
  process.stderr.write(`\n✗ ${msg}\n`);
  process.exit(code);
}

// ── Step 0: aislamiento producción ──────────────────────────────────────────

function assertNotProduction() {
  if (process.env.NODE_ENV === "production") {
    abort(
      "NODE_ENV=production. Este script es SOLO local. Aborto para proteger producción."
    );
  }
  // Doble cinturón: si la URL de BD parece producción, también abortamos.
  const dbUrl = process.env.DATABASE_URL || "";
  if (/(@db:|@localhost\b|@127\.0\.0\.1\b)/i.test(dbUrl) === false) {
    // No es localhost ni el hostname "db" del docker-compose local.
    abort(
      `DATABASE_URL no parece local (${dbUrl.replace(/:[^:@/]+@/, ":***@")}). Aborto.`
    );
  }
}

// ── Step 2: schema PostgreSQL ───────────────────────────────────────────────

async function createSchemaIfNotExists(schemaName) {
  const rawDb = new Sequelize(process.env.DATABASE_URL, {
    dialect: "postgres",
    logging: false,
  });
  await rawDb.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
  await rawDb.close();
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════\n");
  process.stdout.write(" Setup retorika — entorno LOCAL únicamente   \n");
  process.stdout.write("══════════════════════════════════════════════\n");

  // Step 0 — abort si NODE_ENV=production
  assertNotProduction();
  log(0, "NODE_ENV ok (no es production)");

  if (!process.env.DATABASE_URL) {
    abort("DATABASE_URL no configurada. Asegúrate de cargar .env.local.");
  }

  // ── Step 1: master.tenants ───────────────────────────────────────────────
  header("Master tenant");
  getMasterDb();
  const { Tenant, User, TenantModule } = getMasterModels();

  const [tenant, tenantCreated] = await Tenant.findOrCreate({
    where: { slug: SLUG },
    defaults: {
      slug: SLUG,
      name: "Retorika",
      dbName: SCHEMA,
      plan: "pro",
      status: "active",
      settings: { brand: { primaryColor: PRIMARY_COLOR } },
    },
  });
  log(
    1,
    `master.tenants ${tenantCreated ? "CREADO" : "ya existía"} — id=${tenant.id} slug=${tenant.slug}`
  );

  // Si ya existía pero está inactivo o le falta brand, lo dejamos como estaba
  // (no sobrescribimos config manual del operador). Solo logueamos.
  if (!tenantCreated) {
    if (tenant.status !== "active") {
      log(1, `  ⚠ tenant.status="${tenant.status}" — no lo cambio, revisa manualmente`);
    }
  }

  // ── Step 2: schema PostgreSQL ────────────────────────────────────────────
  header(`Schema ${SCHEMA}`);
  await createSchemaIfNotExists(SCHEMA);
  log(2, `CREATE SCHEMA IF NOT EXISTS ${SCHEMA} — OK`);

  // ── Step 3: sequelize.sync ───────────────────────────────────────────────
  header("Sync de tablas (todos los modelos del tenant)");
  const { sequelize, models } = getTenantDb(SLUG);
  await sequelize.sync({ force: false });
  // Listar tablas creadas para reporte
  const [tableRows] = await sequelize.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`,
    { bind: [SCHEMA] }
  );
  log(
    3,
    `sequelize.sync({ force: false }) OK — ${tableRows.length} tablas en ${SCHEMA}`
  );

  // ── Step 4: master.tenant_modules.training ───────────────────────────────
  header("Módulo training");
  const [moduleRow, modCreated] = await TenantModule.findOrCreate({
    where: { tenantId: tenant.id, moduleKey: "training" },
    defaults: {
      tenantId: tenant.id,
      moduleKey: "training",
      enabled: true,
      version: "1.0.0",
      uiOverride: null,
      schemaExtensions: {},
      logicOverrides: {},
      featureFlags: {},
    },
  });
  if (!modCreated && !moduleRow.enabled) {
    await moduleRow.update({ enabled: true });
    log(4, "tenant_modules.training existía pero estaba disabled — ACTIVADO");
  } else {
    log(
      4,
      `tenant_modules.training ${modCreated ? "CREADO" : "ya existía"} (enabled=${moduleRow.enabled})`
    );
  }

  // ── Step 5: usuario admin ────────────────────────────────────────────────
  header(`Usuario admin (${ADMIN_EMAIL})`);
  // Password aleatoria 12 chars (16 base64 con padding/slice). Solo se usa
  // si el user es nuevo — si ya existe, NO la cambiamos.
  const rawPassword = crypto.randomBytes(12).toString("base64").slice(0, 16);
  const passwordHash = await bcrypt.hash(rawPassword, 12);

  const [admin, adminCreated] = await User.findOrCreate({
    where: { email: ADMIN_EMAIL },
    defaults: {
      email: ADMIN_EMAIL,
      passwordHash,
      role: "admin",
      tenantId: tenant.id,
      moduleAccess: ["training"],
      tokenVersion: 1,
    },
  });
  if (adminCreated) {
    log(5, `User CREADO — moduleAccess=["training"], password aleatoria asignada`);
  } else {
    // No tocamos password. Si moduleAccess no incluye training, lo añadimos.
    const currentAccess = admin.moduleAccess ?? [];
    if (!currentAccess.includes("training")) {
      await admin.update({ moduleAccess: [...currentAccess, "training"] });
      log(5, `User ya existía — "training" añadido a moduleAccess (password sin tocar)`);
    } else {
      log(5, `User ya existía — sin cambios (password sin tocar)`);
    }
  }

  // ── Step 6: Course "Liderazgo Educativo" ─────────────────────────────────
  header("Curso de prueba");
  const { Course, Company, TrainingUser } = models;
  const [course, courseCreated] = await Course.findOrCreate({
    where: { wpCourseId: 5383 },
    defaults: {
      name: "Liderazgo Educativo",
      wpCourseId: 5383,
      wcProductId: 5487,
      active: true,
    },
  });
  log(
    6,
    `Course ${courseCreated ? "CREADO" : "ya existía"} — id=${course.id} wpCourseId=${course.wpCourseId} wcProductId=${course.wcProductId}`
  );

  // ── Step 7: Company "Trinity College" ────────────────────────────────────
  header("Empresa de prueba");
  const [company, companyCreated] = await Company.findOrCreate({
    where: { nif: TRINITY_NIF },
    defaults: {
      name: "Trinity College",
      nif: TRINITY_NIF,
      active: true,
    },
  });
  log(
    7,
    `Company ${companyCreated ? "CREADA" : "ya existía"} — id=${company.id} nif=${company.nif}`
  );

  // ── Step 8: TrainingUser x2 ──────────────────────────────────────────────
  header("Alumnos de prueba");
  const studentsData = [
    { email: "profe-test-1@trinitycollege.es", name: "Profesor Test 1" },
    { email: "profe-test-2@trinitycollege.es", name: "Profesor Test 2" },
  ];
  let studentsCreated = 0;
  for (const s of studentsData) {
    const [, sCreated] = await TrainingUser.findOrCreate({
      where: { email: s.email },
      defaults: {
        email: s.email,
        name: s.name,
        type: "company",
        companyId: company.id,
        active: true,
      },
    });
    if (sCreated) studentsCreated++;
  }
  log(
    8,
    `TrainingUsers: ${studentsCreated} creados, ${studentsData.length - studentsCreated} ya existían`
  );

  // ── Step 9: Resumen ──────────────────────────────────────────────────────
  process.stdout.write("\n══════════════════════════════════════════════\n");
  process.stdout.write(" Setup retorika — Resumen                    \n");
  process.stdout.write("══════════════════════════════════════════════\n");
  process.stdout.write(`  Tenant:       ${tenant.name} (slug=${tenant.slug})\n`);
  process.stdout.write(`  Schema:       ${SCHEMA} (${tableRows.length} tablas)\n`);
  process.stdout.write(`  Módulo:       training (enabled=${moduleRow.enabled})\n`);
  process.stdout.write(`  Curso:        ${course.name} (wp=${course.wpCourseId}, wc=${course.wcProductId})\n`);
  process.stdout.write(`  Empresa:      ${company.name} (nif=${company.nif})\n`);
  process.stdout.write(`  Alumnos:      ${studentsData.length}\n`);
  process.stdout.write("══════════════════════════════════════════════\n");

  // Banner credenciales — SOLO si el admin se creó AHORA
  if (adminCreated) {
    process.stdout.write("\n┌──────────────────────────────────────────────┐\n");
    process.stdout.write("│  === CUENTA ADMIN RETORIKA (LOCAL) ===       │\n");
    process.stdout.write("│                                              │\n");
    process.stdout.write(`│  Email:    ${ADMIN_EMAIL.padEnd(34)}│\n`);
    process.stdout.write(`│  Password: ${rawPassword.padEnd(34)}│\n`);
    process.stdout.write("│  URL:      http://localhost:3000             │\n");
    process.stdout.write("│                                              │\n");
    process.stdout.write("│  ⚠ Guarda esta password AHORA — no se        │\n");
    process.stdout.write("│    volverá a mostrar. Solo válida en LOCAL.  │\n");
    process.stdout.write("└──────────────────────────────────────────────┘\n\n");
  } else {
    process.stdout.write("\n  Admin ya existía: password NO mostrada (no se modifica).\n");
    process.stdout.write(`  Email: ${ADMIN_EMAIL}\n`);
    process.stdout.write(`  Si la perdiste, ejecuta un reset ad-hoc.\n\n`);
  }

  // Siguiente paso recordatorio
  process.stdout.write("─────────────────────────────────────────────────\n");
  process.stdout.write(" Siguientes pasos:\n");
  process.stdout.write("   1. npm run db:migrate:course-registrations\n");
  process.stdout.write("   2. Reiniciar dev server (Ctrl+C → npm run dev)\n");
  process.stdout.write("   3. Smoke 5 tests HTTP contra los endpoints\n");
  process.stdout.write("─────────────────────────────────────────────────\n\n");

  await closeAllConnections();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") {
    process.stderr.write(`${err.stack}\n`);
  }
  process.exit(1);
});
