/**
 * add-nutricion-module-nutri-laura.js
 *
 * Sprint nutri-laura Recetario — Checkpoint C1.
 *
 * Activa el módulo "nutricion" SOLO en el tenant nutri_laura:
 *
 *   1. Crea la tabla `foods` en `crm_nutri_laura` con SQL crudo. NO se
 *      replica a otros schemas tenant (el módulo es exclusivo de Laura
 *      por ahora).
 *   2. Registra el módulo `nutricion` en `master.tenant_modules` con
 *      uiOverride='nutri-laura/NutricionFoodsModule' y featureFlag
 *      `externalSearchEnabled: true` para activar el proxy OpenFoodFacts.
 *   3. Añade "nutricion" al `moduleAccess` del admin
 *      (admin@nutri-laura.es).
 *
 * El proyecto no tiene una tabla global `master.modules` (los módulos
 * se materializan implícitamente al insertar filas en
 * `master.tenant_modules`). Por eso la "registración" del módulo en C1
 * se hace activándolo en nutri_laura; en docs/modules/nutricion.md se
 * documenta como decisión.
 *
 * Idempotente: re-ejecutar no rompe nada ni duplica datos.
 *
 * Uso local:  npm run db:add-nutricion-nutri-laura
 * Uso VPS:    npm run db:add-nutricion-nutri-laura:prod
 */

import { Sequelize } from "sequelize";
import { getMasterDb, getMasterModels } from "../../lib/db/masterDb.js";
import { closeAllConnections } from "../../lib/db/tenantDb.js";

const SLUG = "nutri_laura";
const SCHEMA = `crm_${SLUG}`;
const ADMIN_EMAIL = "admin@nutri-laura.es";
const MODULE_KEY = "nutricion";
const UI_OVERRIDE = "nutri-laura/NutricionFoodsModule";

function log(msg) {
  process.stdout.write(`  ${msg}\n`);
}
function header(msg) {
  process.stdout.write(`\n▶ ${msg}\n`);
}

// ─── Helpers de introspección ─────────────────────────────────────────────────

async function enumExists(rawDb, name, schema) {
  const [rows] = await rawDb.query(
    `SELECT 1 FROM pg_type tp
     JOIN pg_namespace n ON n.oid = tp.typnamespace
     WHERE tp.typname = $1 AND n.nspname = $2`,
    { bind: [name, schema] }
  );
  return rows.length > 0;
}

async function tableExists(rawDb, schema, table) {
  const [rows] = await rawDb.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = $1 AND table_name = $2`,
    { bind: [schema, table] }
  );
  return rows.length > 0;
}

async function indexExists(rawDb, schema, indexName) {
  const [rows] = await rawDb.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`,
    { bind: [schema, indexName] }
  );
  return rows.length > 0;
}

// ─── Creación de la tabla foods ──────────────────────────────────────────────

async function createFoodsTableIfNotExist(rawDb, schema) {
  // ── enums ────────────────────────────────────────────────────────────────
  if (!(await enumExists(rawDb, "enum_foods_default_unit", schema))) {
    await rawDb.query(
      `CREATE TYPE "${schema}"."enum_foods_default_unit" AS ENUM ('g','ml','unidad')`
    );
    log(`  ✓ enum enum_foods_default_unit: creado`);
  } else {
    log(`  · enum enum_foods_default_unit: ya existe`);
  }

  if (!(await enumExists(rawDb, "enum_foods_source", schema))) {
    await rawDb.query(
      `CREATE TYPE "${schema}"."enum_foods_source" AS ENUM ('openfoodfacts','custom')`
    );
    log(`  ✓ enum enum_foods_source: creado`);
  } else {
    log(`  · enum enum_foods_source: ya existe`);
  }

  // ── tabla foods ──────────────────────────────────────────────────────────
  if (!(await tableExists(rawDb, schema, "foods"))) {
    await rawDb.query(`
      CREATE TABLE "${schema}"."foods" (
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
      )
    `);
    log(`  ✓ tabla foods: creada`);
  } else {
    log(`  · tabla foods: ya existía`);
  }

  // ── índices ──────────────────────────────────────────────────────────────
  if (!(await indexExists(rawDb, schema, "foods_name_idx"))) {
    await rawDb.query(
      `CREATE INDEX "foods_name_idx" ON "${schema}"."foods" (name)`
    );
    log(`  ✓ index foods_name_idx`);
  } else {
    log(`  · index foods_name_idx: ya existe`);
  }
  if (!(await indexExists(rawDb, schema, "foods_slug_idx"))) {
    await rawDb.query(
      `CREATE INDEX "foods_slug_idx" ON "${schema}"."foods" (slug)`
    );
    log(`  ✓ index foods_slug_idx`);
  } else {
    log(`  · index foods_slug_idx: ya existe`);
  }
  if (!(await indexExists(rawDb, schema, "foods_external_id_idx"))) {
    await rawDb.query(
      `CREATE INDEX "foods_external_id_idx" ON "${schema}"."foods" (external_id)`
    );
    log(`  ✓ index foods_external_id_idx`);
  } else {
    log(`  · index foods_external_id_idx: ya existe`);
  }
  if (!(await indexExists(rawDb, schema, "foods_barcode_idx"))) {
    await rawDb.query(
      `CREATE INDEX "foods_barcode_idx" ON "${schema}"."foods" (barcode)`
    );
    log(`  ✓ index foods_barcode_idx`);
  } else {
    log(`  · index foods_barcode_idx: ya existe`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════\n");
  process.stdout.write(" Nutri Laura — Activar módulo Nutrición (C1)  \n");
  process.stdout.write("══════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  getMasterDb();
  const { Tenant, User, TenantModule } = getMasterModels();

  // ── 1. Verificar tenant ──────────────────────────────────────────────────
  header("Verificando tenant nutri_laura...");
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) {
    process.stderr.write(
      "\n✗ Tenant nutri_laura no encontrado. Ejecuta `npm run db:seed:nutri-laura` primero.\n"
    );
    process.exit(1);
  }
  log(`✓ Tenant encontrado: ${tenant.name} (id: ${tenant.id})`);

  // ── 2. Crear tabla foods en crm_nutri_laura ──────────────────────────────
  header(`Creando tabla foods en ${SCHEMA}...`);
  const rawDb = new Sequelize(process.env.DATABASE_URL, {
    dialect: "postgres",
    logging: false,
  });
  try {
    await createFoodsTableIfNotExist(rawDb, SCHEMA);
  } finally {
    await rawDb.close();
  }

  // ── 3. Registrar módulo nutricion en tenant_modules ─────────────────────
  header("Registrando módulo nutricion en master.tenant_modules...");
  const [moduleRow, modCreated] = await TenantModule.findOrCreate({
    where: { tenantId: tenant.id, moduleKey: MODULE_KEY },
    defaults: {
      tenantId: tenant.id,
      moduleKey: MODULE_KEY,
      enabled: true,
      version: "1.0.0",
      uiOverride: UI_OVERRIDE,
      schemaExtensions: {},
      logicOverrides: {},
      featureFlags: { externalSearchEnabled: true },
    },
  });

  if (!modCreated) {
    const nextFlags = {
      ...(moduleRow.featureFlags || {}),
      externalSearchEnabled: moduleRow.featureFlags?.externalSearchEnabled ?? true,
    };
    await moduleRow.update({
      enabled: true,
      uiOverride: UI_OVERRIDE,
      featureFlags: nextFlags,
    });
    log("· Módulo ya existía — habilitado y actualizado");
  } else {
    log("✓ Módulo nutricion creado (uiOverride + externalSearchEnabled=true)");
  }

  // ── 4. moduleAccess del admin ────────────────────────────────────────────
  header("Actualizando moduleAccess del admin...");
  const admin = await User.findOne({ where: { email: ADMIN_EMAIL } });
  if (!admin) {
    process.stderr.write(`\n✗ Usuario ${ADMIN_EMAIL} no encontrado.\n`);
    process.exit(1);
  }
  const currentAccess = admin.moduleAccess ?? [];
  if (!currentAccess.includes(MODULE_KEY)) {
    await admin.update({ moduleAccess: [...currentAccess, MODULE_KEY] });
    log(`✓ "${MODULE_KEY}" añadido a moduleAccess de ${ADMIN_EMAIL}`);
  } else {
    log(`· ${ADMIN_EMAIL} ya tenía acceso a ${MODULE_KEY}`);
  }

  // ── 5. Resumen ───────────────────────────────────────────────────────────
  process.stdout.write("\n══════════════════════════════════════════════\n");
  process.stdout.write(" ¡Listo!                                      \n");
  process.stdout.write("══════════════════════════════════════════════\n");
  process.stdout.write(`  Schema:           ${SCHEMA}\n`);
  process.stdout.write(`  Tabla:            foods\n`);
  process.stdout.write(`  Módulo:           ${MODULE_KEY}\n`);
  process.stdout.write(`  uiOverride:       ${UI_OVERRIDE}\n`);
  process.stdout.write(`  Feature flag:     externalSearchEnabled=true\n`);
  process.stdout.write(`  Admin con acceso: ${ADMIN_EMAIL}\n`);
  process.stdout.write("══════════════════════════════════════════════\n\n");

  await closeAllConnections();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
