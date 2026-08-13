/**
 * migrate-nutricion-base.js — el CIMIENTO del módulo Nutrición.
 *
 * ── QUÉ AGUJERO TAPA ────────────────────────────────────────────────────────
 * De las nueve tablas de nutrición, cinco (`foods`, `plans`, `plan_meals`,
 * `plan_meal_options`, `plan_meal_option_foods`) no las creaba ninguna
 * migración: las creaban dos scripts de un solo uso con `crm_nutri_laura`
 * escrito a mano dentro —add-nutricion-module-nutri-laura.js (C1) y
 * add-nutricion-c2-plans-nutri-laura.js (C2)—, y ninguno de los dos estaba en
 * el mapa de scripts/_module-migrations.js.
 *
 * Consecuencia: activar `nutricion` en un tenant ANTIGUO ejecutaba las seis
 * migraciones declaradas, las seis se saltaban solas por no encontrar `foods`
 * («faltan foods/plan_meal_options. Se salta») y el cliente se quedaba con el
 * módulo en el menú y cero tablas debajo. Es el mismo fallo que dejó a Abarcaia
 * tres meses sin registrar leads.
 *
 * No había mordido a nadie por dos motivos que se agotaron a la vez: nutrición
 * solo la tenía Laura, y los tenants NUEVOS se salvan de rebote porque
 * `lib/provisioning/altaTenant.js` hace `sequelize.sync()`, que crea TODAS las
 * tablas del modelo tenga o no el módulo. Por eso `somos` (alta del 12/08/2026)
 * sí tiene las nueve y `aumenta` (alta de abril) no tiene ninguna.
 *
 * ── Y UN SEGUNDO AGUJERO: SYNC DA LAS COLUMNAS, NO LAS REGLAS ───────────────
 * Las tablas que nacen de `sequelize.sync()` tienen las mismas columnas que las
 * de Laura —comprobado columna a columna el 13/08/2026— pero NINGUNA de las
 * reglas que C1/C2 escribían en SQL crudo. En producción, `crm_somos` estaba sin
 * `plans_type_client_chk`, sin `plan_meal_option_foods_unit_chk` y sin los tres
 * índices parciales de `plans`. Una tabla así acepta un plan 'template' con
 * cliente asignado, que es justo lo que el CHECK existe para impedir.
 *
 * De ahí las DOS PASADAS, el patrón que ya usa migrate-avisos-cliente.js:
 *   1ª CREAR   sobre los schemas con el módulo activo (`byModule`): una tabla
 *              que no existe en ningún sitio no la encontraría `byTable`.
 *   2ª BLINDAR (constraints + índices) sobre los que YA las tienen (`byTable`),
 *              que alcanza también a donde las creara `sync()`.
 *
 * Va la PRIMERA en MODULES.nutricion: las otras seis migraciones del módulo
 * dependen de que `foods` y `plan_meal_options` existan.
 *
 * Idempotente y sin destruir nada: solo CREATE IF NOT EXISTS a mano y ADD
 * CONSTRAINT / CREATE INDEX de lo que falte. No toca datos.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-nutricion-base.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-nutricion-base.js
 */

import { Sequelize } from "sequelize";
import { byModule, byTable, tableExists } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

// ─── Introspección ──────────────────────────────────────────────────────────

async function enumExists(s, schema, name) {
  const [rows] = await s.query(
    `SELECT 1 FROM pg_type tp JOIN pg_namespace n ON n.oid = tp.typnamespace
      WHERE tp.typname = :name AND n.nspname = :schema`,
    { replacements: { name, schema } }
  );
  return rows.length > 0;
}

async function indexExists(s, schema, name) {
  const [rows] = await s.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = :schema AND indexname = :name`,
    { replacements: { schema, name } }
  );
  return rows.length > 0;
}

async function constraintExists(s, schema, table, name) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.table_constraints
      WHERE table_schema = :schema AND table_name = :table AND constraint_name = :name`,
    { replacements: { schema, table, name } }
  );
  return rows.length > 0;
}

async function schemaExists(s, schema) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.schemata WHERE schema_name = :schema`,
    { replacements: { schema } }
  );
  return rows.length > 0;
}

// ─── Definiciones ───────────────────────────────────────────────────────────

const ENUMS = {
  enum_foods_default_unit: `('g','ml','unidad')`,
  enum_foods_source: `('openfoodfacts','custom')`,
  enum_plans_type: `('template','assigned')`,
  enum_plan_meal_option_foods_unit: `('g','household','free')`,
};

/**
 * Las cinco tablas, EN ORDEN de dependencia (plan_meal_option_foods apunta a
 * plan_meal_options y a foods). El SQL es el de C1/C2 palabra por palabra: es
 * el que lleva un año corriendo en producción bajo Laura, y cualquier variación
 * aquí crearía un tercer dialecto de las mismas tablas.
 */
function tablesSql(schema) {
  return [
    {
      name: "foods",
      sql: `CREATE TABLE "${schema}"."foods" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255),
        default_unit "${schema}"."enum_foods_default_unit" NOT NULL DEFAULT 'g',
        protein_per_100 NUMERIC(8,2),
        carbs_per_100 NUMERIC(8,2),
        fat_per_100 NUMERIC(8,2),
        fiber_per_100 NUMERIC(8,2),
        household_measures JSONB NOT NULL DEFAULT '[]'::jsonb,
        source "${schema}"."enum_foods_source" NOT NULL DEFAULT 'custom',
        external_id VARCHAR(255),
        barcode VARCHAR(255),
        tags TEXT[] NOT NULL DEFAULT '{}',
        archived_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
    },
    {
      name: "plans",
      sql: `CREATE TABLE "${schema}"."plans" (
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
      )`,
    },
    {
      name: "plan_meals",
      sql: `CREATE TABLE "${schema}"."plan_meals" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        plan_id UUID NOT NULL REFERENCES "${schema}"."plans"(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        "order" INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
    },
    {
      name: "plan_meal_options",
      sql: `CREATE TABLE "${schema}"."plan_meal_options" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        meal_id UUID NOT NULL REFERENCES "${schema}"."plan_meals"(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL DEFAULT 'Opción 1',
        "order" INTEGER NOT NULL,
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
    },
    {
      name: "plan_meal_option_foods",
      sql: `CREATE TABLE "${schema}"."plan_meal_option_foods" (
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
      )`,
    },
  ];
}

// Las REGLAS. Se aplican por separado de la creación porque hay que poder
// añadirlas a una tabla que ya existía sin ellas (las de `sequelize.sync()`).
const CHECKS = [
  {
    table: "plans",
    name: "plans_type_client_chk",
    sql: `CHECK (
      (type = 'template' AND client_id IS NULL     AND assigned_at IS NULL)
      OR
      (type = 'assigned' AND client_id IS NOT NULL AND assigned_at IS NOT NULL)
    )`,
  },
  {
    table: "plan_meal_option_foods",
    name: "plan_meal_option_foods_unit_chk",
    sql: `CHECK (
      (unit = 'g'         AND amount IS NOT NULL AND household_label IS NULL     AND household_grams IS NULL)
      OR
      (unit = 'household' AND amount IS NOT NULL AND household_label IS NOT NULL AND household_grams IS NOT NULL)
      OR
      (unit = 'free'      AND amount IS NULL     AND household_label IS NULL     AND household_grams IS NULL)
    )`,
  },
];

const INDEXES = [
  { table: "foods", name: "foods_name_idx", cols: "(name)" },
  { table: "foods", name: "foods_slug_idx", cols: "(slug)" },
  { table: "foods", name: "foods_external_id_idx", cols: "(external_id)" },
  { table: "foods", name: "foods_barcode_idx", cols: "(barcode)" },
  { table: "plans", name: "plans_type_idx", cols: "(type)" },
  { table: "plans", name: "plans_client_id_idx", cols: "(client_id) WHERE client_id IS NOT NULL" },
  { table: "plans", name: "plans_template_id_idx", cols: "(template_id) WHERE template_id IS NOT NULL" },
  { table: "plans", name: "plans_archived_at_idx", cols: "(archived_at) WHERE archived_at IS NOT NULL" },
  { table: "plan_meals", name: "plan_meals_plan_id_idx", cols: "(plan_id)" },
  { table: "plan_meal_options", name: "plan_meal_options_meal_id_idx", cols: "(meal_id)" },
  { table: "plan_meal_option_foods", name: "plan_meal_option_foods_option_id_idx", cols: "(option_id)" },
  { table: "plan_meal_option_foods", name: "plan_meal_option_foods_food_id_idx", cols: "(food_id)" },
];

// ─── Pasada 1: CREAR ────────────────────────────────────────────────────────

async function crear(s, schema) {
  for (const [name, valores] of Object.entries(ENUMS)) {
    if (await enumExists(s, schema, name)) continue;
    await s.query(`CREATE TYPE "${schema}"."${name}" AS ENUM ${valores}`);
    log(`✓ ${schema}: enum ${name}`);
  }

  for (const { name, sql } of tablesSql(schema)) {
    if (await tableExists(s, schema, name)) continue;
    await s.query(sql);
    log(`✓ ${schema}.${name}: tabla creada`);
  }
}

// ─── Pasada 2: BLINDAR ──────────────────────────────────────────────────────

async function blindar(s, schema) {
  for (const { table, name, sql } of CHECKS) {
    if (!(await tableExists(s, schema, table))) continue;
    if (await constraintExists(s, schema, table, name)) continue;
    try {
      await s.query(`ALTER TABLE "${schema}"."${table}" ADD CONSTRAINT "${name}" ${sql}`);
      log(`✓ ${schema}.${table}: constraint ${name} añadido`);
    } catch (err) {
      // 23514 = check_violation: la tabla ya tiene filas que incumplen la regla.
      // No se fuerza ni se borra nada — se avisa FUERTE y se sigue, porque el
      // arreglo es de datos y lo tiene que decidir una persona.
      const code = err?.parent?.code || err?.original?.code;
      if (code === "23514") {
        log(`⚠ ${schema}.${table}: HAY FILAS QUE INCUMPLEN ${name}. Constraint NO añadido.`);
        log(`  Revisa esas filas a mano; hasta entonces esa tabla acepta datos incoherentes.`);
      } else {
        throw err;
      }
    }
  }

  for (const { table, name, cols } of INDEXES) {
    if (!(await tableExists(s, schema, table))) continue;
    if (await indexExists(s, schema, name)) continue;
    await s.query(`CREATE INDEX "${name}" ON "${schema}"."${table}" ${cols}`);
    log(`✓ ${schema}: index ${name}`);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: Nutrición — tablas base (foods + planes)\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  try {
    await s.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  } catch {
    // Sin permiso para crear extensiones: si gen_random_uuid() ya está (PG13+
    // lo trae de serie), no pasa nada. Si no está, el CREATE TABLE lo dirá.
  }

  header("Pasada 1 — crear (schemas con el módulo `nutricion`)");
  const { schemas: conModulo } = await byModule(s, "nutricion");
  if (conModulo.length === 0) {
    log("· Ningún tenant con nutrición todavía.");
  }
  for (const schema of conModulo) {
    if (!(await schemaExists(s, schema))) {
      log(`✗ ${schema}: el schema no existe, se salta`);
      continue;
    }
    try {
      await crear(s, schema);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  // Blindar alcanza a TODO schema que tenga las tablas, tenga o no el módulo
  // activo: es donde aparecen las que creó `sequelize.sync()` en el alta.
  header("Pasada 2 — blindar (schemas que ya tienen las tablas)");
  const { schemas: conTabla } = await byTable(s, "plans");
  if (conTabla.length === 0) {
    log("· Ningún schema con `plans` todavía.");
  }
  for (const schema of conTabla) {
    try {
      await blindar(s, schema);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n✓ Migración completada\n\n");
  await s.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
