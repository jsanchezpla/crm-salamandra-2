/**
 * add-nutricion-c2-plans-nutri-laura.js
 *
 * Sprint nutri-laura Recetario — Checkpoint C2.
 *
 * Crea, SOLO en el schema crm_nutri_laura, las 4 tablas del modelo de
 * planes nutricionales:
 *
 *   - plans
 *   - plan_meals
 *   - plan_meal_options
 *   - plan_meal_option_foods
 *
 * + sus enums (plan_type, plan_meal_option_food_unit), índices (algunos
 * parciales) y constraints CHECK que garantizan la integridad de:
 *
 *   1) plans.type='template'  ⇔  client_id IS NULL AND assigned_at IS NULL
 *      plans.type='assigned'  ⇔  client_id IS NOT NULL AND assigned_at IS NOT NULL
 *   2) plan_meal_option_foods.unit='g'         ⇒ amount NOT NULL, no household
 *      plan_meal_option_foods.unit='household' ⇒ amount NOT NULL + household_label + household_grams
 *      plan_meal_option_foods.unit='free'      ⇒ amount NULL, no household
 *
 * FK plan_meal_option_foods.food_id → foods.id ON DELETE RESTRICT.
 *
 * NO toca el módulo en master.tenant_modules (C1 ya lo activó) ni
 * añade el módulo a otros tenants.
 *
 * Idempotente: re-ejecutar no rompe nada ni duplica datos.
 *
 * Uso local:  npm run db:add-nutricion-c2-nutri-laura
 * Uso VPS:    docker exec -it crm-salamandra-app-1 node scripts/add-nutricion-c2-plans-nutri-laura.js
 */

import { Sequelize } from "sequelize";

const SCHEMA = "crm_nutri_laura";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function enumExists(s, name, schema) {
  const [rows] = await s.query(
    `SELECT 1 FROM pg_type tp
     JOIN pg_namespace n ON n.oid = tp.typnamespace
     WHERE tp.typname = $1 AND n.nspname = $2`,
    { bind: [name, schema] }
  );
  return rows.length > 0;
}

async function tableExists(s, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = $1 AND table_name = $2`,
    { bind: [schema, table] }
  );
  return rows.length > 0;
}

async function indexExists(s, schema, name) {
  const [rows] = await s.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`,
    { bind: [schema, name] }
  );
  return rows.length > 0;
}

async function constraintExists(s, schema, table, name) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.table_constraints
     WHERE table_schema = $1 AND table_name = $2 AND constraint_name = $3`,
    { bind: [schema, table, name] }
  );
  return rows.length > 0;
}

// ─── Enums ───────────────────────────────────────────────────────────────────

async function createEnums(s, schema) {
  if (!(await enumExists(s, "enum_plans_type", schema))) {
    await s.query(`CREATE TYPE "${schema}"."enum_plans_type" AS ENUM ('template','assigned')`);
    log(`  ✓ enum enum_plans_type creado`);
  } else {
    log(`  · enum enum_plans_type ya existe`);
  }

  if (!(await enumExists(s, "enum_plan_meal_option_foods_unit", schema))) {
    await s.query(
      `CREATE TYPE "${schema}"."enum_plan_meal_option_foods_unit" AS ENUM ('g','household','free')`
    );
    log(`  ✓ enum enum_plan_meal_option_foods_unit creado`);
  } else {
    log(`  · enum enum_plan_meal_option_foods_unit ya existe`);
  }
}

// ─── Tabla plans ─────────────────────────────────────────────────────────────

async function createPlans(s, schema) {
  if (!(await tableExists(s, schema, "plans"))) {
    await s.query(`
      CREATE TABLE "${schema}"."plans" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        type "${schema}"."enum_plans_type" NOT NULL,
        template_id UUID REFERENCES "${schema}"."plans"(id) ON DELETE SET NULL,
        client_id UUID,
        visible_to_client BOOLEAN NOT NULL DEFAULT FALSE,
        assigned_at TIMESTAMPTZ,
        archived_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    log(`  ✓ tabla plans creada`);
  } else {
    log(`  · tabla plans ya existe`);
  }

  // CHECK: coherencia type / client_id / assigned_at
  if (!(await constraintExists(s, schema, "plans", "plans_type_client_chk"))) {
    await s.query(`
      ALTER TABLE "${schema}"."plans"
      ADD CONSTRAINT "plans_type_client_chk" CHECK (
        (type = 'template' AND client_id IS NULL  AND assigned_at IS NULL)
        OR
        (type = 'assigned' AND client_id IS NOT NULL AND assigned_at IS NOT NULL)
      )
    `);
    log(`  ✓ constraint plans_type_client_chk añadido`);
  } else {
    log(`  · constraint plans_type_client_chk ya existe`);
  }

  // Índices
  if (!(await indexExists(s, schema, "plans_type_idx"))) {
    await s.query(`CREATE INDEX "plans_type_idx" ON "${schema}"."plans" (type)`);
    log(`  ✓ index plans_type_idx`);
  } else log(`  · index plans_type_idx ya existe`);

  if (!(await indexExists(s, schema, "plans_client_id_idx"))) {
    await s.query(
      `CREATE INDEX "plans_client_id_idx" ON "${schema}"."plans" (client_id) WHERE client_id IS NOT NULL`
    );
    log(`  ✓ index plans_client_id_idx (parcial)`);
  } else log(`  · index plans_client_id_idx ya existe`);

  if (!(await indexExists(s, schema, "plans_template_id_idx"))) {
    await s.query(
      `CREATE INDEX "plans_template_id_idx" ON "${schema}"."plans" (template_id) WHERE template_id IS NOT NULL`
    );
    log(`  ✓ index plans_template_id_idx (parcial)`);
  } else log(`  · index plans_template_id_idx ya existe`);

  if (!(await indexExists(s, schema, "plans_archived_at_idx"))) {
    await s.query(
      `CREATE INDEX "plans_archived_at_idx" ON "${schema}"."plans" (archived_at) WHERE archived_at IS NOT NULL`
    );
    log(`  ✓ index plans_archived_at_idx (parcial)`);
  } else log(`  · index plans_archived_at_idx ya existe`);
}

// ─── plan_meals ──────────────────────────────────────────────────────────────

async function createPlanMeals(s, schema) {
  if (!(await tableExists(s, schema, "plan_meals"))) {
    await s.query(`
      CREATE TABLE "${schema}"."plan_meals" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        plan_id UUID NOT NULL REFERENCES "${schema}"."plans"(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        "order" INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    log(`  ✓ tabla plan_meals creada`);
  } else log(`  · tabla plan_meals ya existe`);

  if (!(await indexExists(s, schema, "plan_meals_plan_id_idx"))) {
    await s.query(`CREATE INDEX "plan_meals_plan_id_idx" ON "${schema}"."plan_meals" (plan_id)`);
    log(`  ✓ index plan_meals_plan_id_idx`);
  } else log(`  · index plan_meals_plan_id_idx ya existe`);
}

// ─── plan_meal_options ───────────────────────────────────────────────────────

async function createPlanMealOptions(s, schema) {
  if (!(await tableExists(s, schema, "plan_meal_options"))) {
    await s.query(`
      CREATE TABLE "${schema}"."plan_meal_options" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        meal_id UUID NOT NULL REFERENCES "${schema}"."plan_meals"(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL DEFAULT 'Opción 1',
        "order" INTEGER NOT NULL,
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    log(`  ✓ tabla plan_meal_options creada`);
  } else log(`  · tabla plan_meal_options ya existe`);

  if (!(await indexExists(s, schema, "plan_meal_options_meal_id_idx"))) {
    await s.query(
      `CREATE INDEX "plan_meal_options_meal_id_idx" ON "${schema}"."plan_meal_options" (meal_id)`
    );
    log(`  ✓ index plan_meal_options_meal_id_idx`);
  } else log(`  · index plan_meal_options_meal_id_idx ya existe`);
}

// ─── plan_meal_option_foods ──────────────────────────────────────────────────

async function createPlanMealOptionFoods(s, schema) {
  if (!(await tableExists(s, schema, "plan_meal_option_foods"))) {
    await s.query(`
      CREATE TABLE "${schema}"."plan_meal_option_foods" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        option_id UUID NOT NULL REFERENCES "${schema}"."plan_meal_options"(id) ON DELETE CASCADE,
        food_id UUID NOT NULL REFERENCES "${schema}"."foods"(id) ON DELETE RESTRICT,
        amount NUMERIC(10,2),
        unit "${schema}"."enum_plan_meal_option_foods_unit" NOT NULL,
        household_label VARCHAR(255),
        household_grams NUMERIC(10,2),
        notes TEXT,
        "order" INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    log(`  ✓ tabla plan_meal_option_foods creada`);
  } else log(`  · tabla plan_meal_option_foods ya existe`);

  if (!(await constraintExists(s, schema, "plan_meal_option_foods", "plan_meal_option_foods_unit_chk"))) {
    await s.query(`
      ALTER TABLE "${schema}"."plan_meal_option_foods"
      ADD CONSTRAINT "plan_meal_option_foods_unit_chk" CHECK (
        (unit = 'g'         AND amount IS NOT NULL AND household_label IS NULL     AND household_grams IS NULL)
        OR
        (unit = 'household' AND amount IS NOT NULL AND household_label IS NOT NULL AND household_grams IS NOT NULL)
        OR
        (unit = 'free'      AND amount IS NULL     AND household_label IS NULL     AND household_grams IS NULL)
      )
    `);
    log(`  ✓ constraint plan_meal_option_foods_unit_chk añadido`);
  } else log(`  · constraint plan_meal_option_foods_unit_chk ya existe`);

  if (!(await indexExists(s, schema, "plan_meal_option_foods_option_id_idx"))) {
    await s.query(
      `CREATE INDEX "plan_meal_option_foods_option_id_idx" ON "${schema}"."plan_meal_option_foods" (option_id)`
    );
    log(`  ✓ index plan_meal_option_foods_option_id_idx`);
  } else log(`  · index plan_meal_option_foods_option_id_idx ya existe`);

  if (!(await indexExists(s, schema, "plan_meal_option_foods_food_id_idx"))) {
    await s.query(
      `CREATE INDEX "plan_meal_option_foods_food_id_idx" ON "${schema}"."plan_meal_option_foods" (food_id)`
    );
    log(`  ✓ index plan_meal_option_foods_food_id_idx`);
  } else log(`  · index plan_meal_option_foods_food_id_idx ya existe`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════\n");
  process.stdout.write(" Nutri Laura — Recetario C2 (plans)           \n");
  process.stdout.write("══════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  try {
    // Pre-check: la tabla foods de C1 debe existir.
    if (!(await tableExists(s, SCHEMA, "foods"))) {
      process.stderr.write(
        `\n✗ ${SCHEMA}.foods no existe — ejecuta primero add-nutricion-module-nutri-laura.js (C1).\n`
      );
      process.exit(1);
    }

    header("Fase A — enums");
    await createEnums(s, SCHEMA);

    header("Fase B — tabla plans + constraint + índices");
    await createPlans(s, SCHEMA);

    header("Fase C — tabla plan_meals + índice");
    await createPlanMeals(s, SCHEMA);

    header("Fase D — tabla plan_meal_options + índice");
    await createPlanMealOptions(s, SCHEMA);

    header("Fase E — tabla plan_meal_option_foods + constraint + índices");
    await createPlanMealOptionFoods(s, SCHEMA);

    process.stdout.write("\n══════════════════════════════════════════════\n");
    process.stdout.write(" ✓ Migración C2 completada                    \n");
    process.stdout.write("══════════════════════════════════════════════\n\n");
  } finally {
    await s.close();
  }
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
