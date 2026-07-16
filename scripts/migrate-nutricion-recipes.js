/**
 * migrate-nutricion-recipes.js — Sprint 8.2 (nutri_laura): recetario.
 *
 * Migración PURAMENTE ADITIVA (backfill Z = coexistencia): crea 4 tablas nuevas
 * sin tocar las existentes. La estructura antigua (plan_meal_option_foods) sigue
 * funcionando; Laura crea recetas nuevas a su ritmo. NO convierte datos vivos.
 *
 * Tablas creadas (en cada schema con módulo `nutricion` que ya tenga foods +
 * plan_meal_options):
 *   - recipes                        (catálogo de recetas)
 *   - recipe_foods                   (ingredientes de la receta → foods)
 *   - plan_meal_option_recipes       (receta CONGELADA dentro de una opción; raciones)
 *   - plan_meal_option_recipe_foods  (ingrediente congelado del snapshot → foods)
 *
 * Reutiliza el enum existente enum_plan_meal_option_foods_unit (g|household|free).
 *
 * Regla #12: lee los schemas de `master.tenants` JOIN `tenant_modules` en runtime
 * (module_key='nutricion'), nunca hardcodea slugs. Idempotente.
 *
 * ⚠️ STAGING: para ensayar contra una copia (`crm_nutri_staging`) que NO es un
 * tenant en master.tenants, pasar los schemas extra por env:
 *     EXTRA_SCHEMAS=crm_nutri_staging node --env-file=.env.local scripts/migrate-nutricion-recipes.js
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-nutricion-recipes.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-nutricion-recipes.js
 */

import { Sequelize } from "sequelize";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function schemaExists(s, schema) {
  const [rows] = await s.query(`SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`, { bind: [schema] });
  return rows.length > 0;
}
async function tableExists(s, t, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    { bind: [schema, table], transaction: t }
  );
  return rows.length > 0;
}
async function enumTypeExists(s, name, schema) {
  const [rows] = await s.query(
    `SELECT 1 FROM pg_type tp JOIN pg_namespace n ON n.oid = tp.typnamespace WHERE tp.typname = $1 AND n.nspname = $2`,
    { bind: [name, schema] }
  );
  return rows.length > 0;
}
async function indexExists(s, t, schema, indexName) {
  const [rows] = await s.query(`SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`, {
    bind: [schema, indexName], transaction: t,
  });
  return rows.length > 0;
}

async function ensureUuidFn(s) {
  try { await s.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`); } catch { /* sin permiso */ }
  try { await s.query(`SELECT gen_random_uuid()`); return true; } catch { return false; }
}

async function ensureIndex(s, t, schema, indexName, table, colsSql) {
  if (await indexExists(s, t, schema, indexName)) return;
  await s.query(`CREATE INDEX "${indexName}" ON "${schema}"."${table}" ${colsSql}`, { transaction: t });
  log(`✓ ${schema} index ${indexName}`);
}

async function fetchTargetSlugs(s) {
  const [rows] = await s.query(`
    SELECT DISTINCT t.slug
    FROM master.tenants t
    JOIN master.tenant_modules tm ON tm.tenant_id = t.id
    WHERE t.status = 'active' AND tm.enabled = TRUE AND tm.module_key = 'nutricion'
    ORDER BY t.slug
  `);
  return rows.map((r) => r.slug);
}

async function ensureTables(s, t, schema, uuidDefault) {
  const idCol = `id UUID PRIMARY KEY${uuidDefault ? " DEFAULT gen_random_uuid()" : ""}`;
  const unitEnum = `"${schema}"."enum_plan_meal_option_foods_unit"`;

  // Defensivo: el enum de unidad debería existir (lo creó C2); si no, crearlo.
  if (!(await enumTypeExists(s, "enum_plan_meal_option_foods_unit", schema))) {
    await s.query(`CREATE TYPE ${unitEnum} AS ENUM ('g','household','free')`);
    log(`✓ ${schema} enum enum_plan_meal_option_foods_unit creado (defensivo)`);
  }

  // ── recipes ──
  if (!(await tableExists(s, t, schema, "recipes"))) {
    await s.query(
      `CREATE TABLE "${schema}"."recipes" (
        ${idCol},
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_by UUID,
        is_archived BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      { transaction: t }
    );
    log(`✓ ${schema}.recipes: tabla creada`);
  }
  await ensureIndex(s, t, schema, "recipes_is_archived_idx", "recipes", "(is_archived)");

  // ── recipe_foods ──
  if (!(await tableExists(s, t, schema, "recipe_foods"))) {
    await s.query(
      `CREATE TABLE "${schema}"."recipe_foods" (
        ${idCol},
        recipe_id UUID NOT NULL REFERENCES "${schema}"."recipes"(id) ON DELETE CASCADE,
        food_id UUID NOT NULL REFERENCES "${schema}"."foods"(id) ON DELETE RESTRICT,
        amount NUMERIC(10,2),
        unit ${unitEnum} NOT NULL,
        household_label VARCHAR(255),
        household_grams NUMERIC(10,2),
        notes TEXT,
        ordering INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT recipe_foods_unit_chk CHECK (
          (unit = 'g'         AND amount IS NOT NULL AND household_label IS NULL     AND household_grams IS NULL)
          OR (unit = 'household' AND amount IS NOT NULL AND household_label IS NOT NULL AND household_grams IS NOT NULL)
          OR (unit = 'free'      AND amount IS NULL     AND household_label IS NULL     AND household_grams IS NULL)
        )
      )`,
      { transaction: t }
    );
    log(`✓ ${schema}.recipe_foods: tabla creada`);
  }
  await ensureIndex(s, t, schema, "recipe_foods_recipe_id_idx", "recipe_foods", "(recipe_id)");
  await ensureIndex(s, t, schema, "recipe_foods_food_id_idx", "recipe_foods", "(food_id)");

  // ── plan_meal_option_recipes ──
  if (!(await tableExists(s, t, schema, "plan_meal_option_recipes"))) {
    await s.query(
      `CREATE TABLE "${schema}"."plan_meal_option_recipes" (
        ${idCol},
        plan_meal_option_id UUID NOT NULL REFERENCES "${schema}"."plan_meal_options"(id) ON DELETE CASCADE,
        recipe_id UUID REFERENCES "${schema}"."recipes"(id) ON DELETE SET NULL,
        name_snapshot VARCHAR(255) NOT NULL,
        servings NUMERIC(6,2) NOT NULL DEFAULT 1 CHECK (servings > 0),
        ordering INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      { transaction: t }
    );
    log(`✓ ${schema}.plan_meal_option_recipes: tabla creada`);
  }
  await ensureIndex(s, t, schema, "pmor_option_id_idx", "plan_meal_option_recipes", "(plan_meal_option_id)");
  await ensureIndex(s, t, schema, "pmor_recipe_id_idx", "plan_meal_option_recipes", "(recipe_id)");

  // ── plan_meal_option_recipe_foods ──
  if (!(await tableExists(s, t, schema, "plan_meal_option_recipe_foods"))) {
    await s.query(
      `CREATE TABLE "${schema}"."plan_meal_option_recipe_foods" (
        ${idCol},
        plan_meal_option_recipe_id UUID NOT NULL REFERENCES "${schema}"."plan_meal_option_recipes"(id) ON DELETE CASCADE,
        food_id UUID NOT NULL REFERENCES "${schema}"."foods"(id) ON DELETE RESTRICT,
        amount_snapshot NUMERIC(10,2),
        unit_snapshot ${unitEnum} NOT NULL,
        household_label_snapshot VARCHAR(255),
        household_grams_snapshot NUMERIC(10,2),
        notes_snapshot TEXT,
        ordering INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pmorf_unit_chk CHECK (
          (unit_snapshot = 'g'         AND amount_snapshot IS NOT NULL AND household_label_snapshot IS NULL     AND household_grams_snapshot IS NULL)
          OR (unit_snapshot = 'household' AND amount_snapshot IS NOT NULL AND household_label_snapshot IS NOT NULL AND household_grams_snapshot IS NOT NULL)
          OR (unit_snapshot = 'free'      AND amount_snapshot IS NULL     AND household_label_snapshot IS NULL     AND household_grams_snapshot IS NULL)
        )
      )`,
      { transaction: t }
    );
    log(`✓ ${schema}.plan_meal_option_recipe_foods: tabla creada`);
  }
  await ensureIndex(s, t, schema, "pmorf_recipe_id_idx", "plan_meal_option_recipe_foods", "(plan_meal_option_recipe_id)");
  await ensureIndex(s, t, schema, "pmorf_food_id_idx", "plan_meal_option_recipe_foods", "(food_id)");
}

async function processSchema(s, schema) {
  // Prerequisitos del recetario: foods (C1) + plan_meal_options (C2).
  if (!(await tableExists(s, null, schema, "foods")) || !(await tableExists(s, null, schema, "plan_meal_options"))) {
    log(`✗ ${schema}: faltan foods/plan_meal_options (C1/C2 no aplicados). Se salta.`);
    return;
  }
  const uuidDefault = await ensureUuidFn(s);
  await s.transaction(async (t) => {
    await ensureTables(s, t, schema, uuidDefault);
  });
  log(`✓ ${schema}: listo`);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: Nutrición — Recetario (Sprint 8.2, aditivo)\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const sequelize = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  // ONLY_SCHEMAS: modo EXCLUSIVO — migra SOLO esos schemas, ignorando la lista
  // de tenants. Para ensayar en staging SIN tocar prod:
  //   ONLY_SCHEMAS=crm_nutri_staging node scripts/migrate-nutricion-recipes.js
  // EXTRA_SCHEMAS: modo ADITIVO — añade schemas a la lista de tenants (para
  // migrar prod + un schema extra a la vez).
  const only = (process.env.ONLY_SCHEMAS || "").split(",").map((x) => x.trim()).filter(Boolean);
  let schemas;
  if (only.length > 0) {
    schemas = [...new Set(only)];
    log(`⚠ ONLY_SCHEMAS activo: se IGNORA la lista de tenants. Solo: ${schemas.join(", ")}`);
  } else {
    const slugs = await fetchTargetSlugs(sequelize);
    const tenantSchemas = slugs.map((slug) => `crm_${slug}`);
    const extra = (process.env.EXTRA_SCHEMAS || "").split(",").map((x) => x.trim()).filter(Boolean);
    schemas = [...new Set([...tenantSchemas, ...extra])];
    if (extra.length) log(`· EXTRA_SCHEMAS (aditivo a tenants): ${extra.join(", ")}`);
  }

  if (schemas.length === 0) {
    log("· Ningún schema objetivo (ni tenant con nutricion, ni EXTRA/ONLY_SCHEMAS).");
    await sequelize.close();
    process.exit(0);
  }
  log(`✓ ${schemas.length} schema(s): ${schemas.join(", ")}`);

  for (const schema of schemas) {
    header(`Schema ${schema}`);
    if (!(await schemaExists(sequelize, schema))) {
      log(`✗ schema ${schema} no existe, se salta`);
      continue;
    }
    try {
      await processSchema(sequelize, schema);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n✓ Migración completada\n\n");
  await sequelize.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
