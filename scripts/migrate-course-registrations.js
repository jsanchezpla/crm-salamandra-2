/**
 * migrate-course-registrations.js
 *
 * Sprint Retorika "Registros previos al curso".
 *
 * Cambios en cada tenant con módulo `training` habilitado:
 *   1. ADD COLUMN companies.nif (STRING NULL) + índice companies_nif_idx.
 *   2. CREATE TABLE course_registrations con todos los campos del modelo
 *      CourseRegistration (FKs a courses/training_users/companies con
 *      ON DELETE SET NULL).
 *   3. Índices: email, wp_product_id, wp_course_id, center_nif,
 *      submitted_at DESC, y compuesto (email, wp_product_id) para el
 *      lookup rápido del endpoint /check.
 *
 * Multi-tenant idempotente:
 *   - Lee tenants con training habilitado desde master.tenant_modules.
 *   - Pre-check `tableExists(companies)` por tenant; si el módulo no está
 *     instalado físicamente, salta.
 *   - ADD COLUMN IF NOT EXISTS + CREATE TABLE IF NOT EXISTS + CREATE INDEX
 *     IF NOT EXISTS. Re-ejecutar es seguro.
 *
 * Uso:
 *   npm run db:migrate:course-registrations         (local)
 *   npm run db:migrate:course-registrations:prod    (producción)
 */

import { Sequelize } from "sequelize";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function tableExists(s, t, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    { bind: [schema, table], transaction: t }
  );
  return rows.length > 0;
}

async function columnExists(s, t, schema, table, column) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
    { bind: [schema, table, column], transaction: t }
  );
  return rows.length > 0;
}

async function indexExists(s, t, schema, indexName) {
  const [rows] = await s.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`,
    { bind: [schema, indexName], transaction: t }
  );
  return rows.length > 0;
}

async function processSchemaInTx(s, t, schema) {
  if (!(await tableExists(s, t, schema, "companies"))) {
    log(`· ${schema}.companies: no existe, salto (módulo training no instalado)`);
    return false;
  }

  // ── 1) ADD COLUMN companies.nif ────────────────────────────────────────
  if (!(await columnExists(s, t, schema, "companies", "nif"))) {
    await s.query(
      `ALTER TABLE "${schema}"."companies" ADD COLUMN "nif" VARCHAR(255)`,
      { transaction: t }
    );
    log(`✓ ${schema}.companies.nif: columna creada`);
  } else {
    log(`· ${schema}.companies.nif: ya existe`);
  }

  if (!(await indexExists(s, t, schema, "companies_nif_idx"))) {
    await s.query(
      `CREATE INDEX "companies_nif_idx" ON "${schema}"."companies" (nif)`,
      { transaction: t }
    );
    log(`✓ ${schema} index companies_nif_idx: creado`);
  } else {
    log(`· ${schema} index companies_nif_idx: ya existe`);
  }

  // ── 2) CREATE TABLE course_registrations ───────────────────────────────
  if (!(await tableExists(s, t, schema, "course_registrations"))) {
    await s.query(
      `
      CREATE TABLE "${schema}"."course_registrations" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        training_user_id UUID REFERENCES "${schema}"."training_users"(id) ON DELETE SET NULL,
        course_id UUID REFERENCES "${schema}"."courses"(id) ON DELETE SET NULL,
        company_id UUID REFERENCES "${schema}"."companies"(id) ON DELETE SET NULL,
        email VARCHAR(255) NOT NULL,
        wp_user_id INTEGER,
        wp_product_id INTEGER NOT NULL,
        wp_course_id INTEGER NOT NULL,
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        center_nif VARCHAR(255),
        center_name VARCHAR(255) NOT NULL,
        center_data JSONB DEFAULT '{}'::jsonb,
        teacher_data JSONB DEFAULT '{}'::jsonb,
        diagnosis_data JSONB DEFAULT '{}'::jsonb,
        raw_payload JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
      `,
      { transaction: t }
    );
    log(`✓ ${schema}.course_registrations: tabla creada`);
  } else {
    log(`· ${schema}.course_registrations: ya existe`);
  }

  // ── 3) Índices de course_registrations ─────────────────────────────────
  const indexes = [
    ["course_registrations_email_idx", `(email)`],
    ["course_registrations_wp_product_id_idx", `(wp_product_id)`],
    ["course_registrations_wp_course_id_idx", `(wp_course_id)`],
    ["course_registrations_center_nif_idx", `(center_nif)`],
    ["course_registrations_submitted_at_idx", `(submitted_at DESC)`],
    // Compuesto crítico para el endpoint /check (email + productId).
    ["course_registrations_email_product_idx", `(email, wp_product_id)`],
  ];
  for (const [name, cols] of indexes) {
    if (!(await indexExists(s, t, schema, name))) {
      await s.query(
        `CREATE INDEX "${name}" ON "${schema}"."course_registrations" ${cols}`,
        { transaction: t }
      );
      log(`✓ ${schema} index ${name}: creado`);
    } else {
      log(`· ${schema} index ${name}: ya existe`);
    }
  }

  return true;
}

async function fetchTenantsWithTraining(s) {
  const [rows] = await s.query(`
    SELECT t.slug
    FROM master.tenants t
    JOIN master.tenant_modules tm ON tm.tenant_id = t.id
    WHERE t.status = 'active' AND tm.module_key = 'training' AND tm.enabled = true
    ORDER BY t.slug
  `);
  return rows.map((r) => r.slug);
}

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: course_registrations + companies.nif      \n");
  process.stdout.write("══════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: "postgres",
    logging: false,
  });

  try {
    header("Obteniendo tenants con módulo training habilitado...");
    const slugs = await fetchTenantsWithTraining(sequelize);
    if (slugs.length === 0) {
      log("· Ningún tenant tiene el módulo training habilitado. Nada que hacer.");
      await sequelize.close();
      process.exit(0);
    }
    log(`✓ ${slugs.length} tenants: ${slugs.join(", ")}`);

    header("Aplicando cambios (transacción global)...");
    const processed = [];
    await sequelize.transaction(async (t) => {
      for (const slug of slugs) {
        const schema = `crm_${slug}`;
        process.stdout.write(`\n· Schema ${schema}\n`);
        const ok = await processSchemaInTx(sequelize, t, schema);
        if (ok) processed.push(schema);
      }
    });

    process.stdout.write("\n══════════════════════════════════════════════════════\n");
    process.stdout.write(" ✓ Migración completada                              \n");
    process.stdout.write("══════════════════════════════════════════════════════\n");
    process.stdout.write(` ℹ Schemas afectados: ${processed.join(", ") || "(ninguno)"}\n`);
    process.stdout.write("══════════════════════════════════════════════════════\n\n");

    await sequelize.close();
    process.exit(0);
  } catch (err) {
    await sequelize.close();
    throw err;
  }
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
