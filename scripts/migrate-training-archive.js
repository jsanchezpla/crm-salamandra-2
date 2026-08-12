/**
 * migrate-training-archive.js
 *
 * Sprint F3 del módulo Training.
 *
 * Cambios:
 *   - ADD COLUMN archived_at (TIMESTAMPTZ NULL) en training_users
 *   - CREATE TYPE enum_training_sync_log_source
 *   - CREATE TABLE training_sync_log (id, source, synced_at, items_synced,
 *     items_deactivated, items_failed, payload, timestamps)
 *   - Índice training_sync_log_synced_at_idx para queries "última sync"
 *
 * Estrategia:
 *   - Fase A en autocommit: CREATE TYPE de enum (Postgres no permite ADD VALUE
 *     en la misma transacción; aquí solo creamos enum nuevo).
 *   - Fase B en transacción global: ADD COLUMN + CREATE TABLE + índice.
 *   - Idempotente. Lee slugs activos desde master.tenants.
 *   - Tenants sin tabla `training_users` (módulo no instalado) se saltan.
 *
 * Uso:
 *   npm run db:migrate:training-archive       (local)
 *   npm run db:migrate:training-archive:prod  (producción)
 */

import { Sequelize } from "sequelize";
import { acotarSlugs } from "./_solo-este-tenant.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

// ─── Helpers de introspección ──────────────────────────────────────────────

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

async function enumTypeExists(s, t, enumTypeName, schema) {
  const [rows] = await s.query(
    `SELECT 1 FROM pg_type tp
     JOIN pg_namespace n ON n.oid = tp.typnamespace
     WHERE tp.typname = $1 AND n.nspname = $2`,
    { bind: [enumTypeName, schema], transaction: t ?? undefined }
  );
  return rows.length > 0;
}

// ─── Fase A: CREATE TYPE en autocommit ─────────────────────────────────────

async function createEnumsAutocommit(s, schema) {
  // Solo crea el enum si el schema tiene tabla training_users (el módulo training
  // está instalado). Evita ensuciar tenants sin formación.
  if (!(await tableExists(s, null, schema, "training_users"))) {
    log(`· ${schema}: sin training_users (módulo no instalado), salto`);
    return false;
  }

  if (!(await enumTypeExists(s, null, "enum_training_sync_log_source", schema))) {
    await s.query(
      `CREATE TYPE "${schema}"."enum_training_sync_log_source" AS ENUM ('wp_tutor_courses')`
    );
    log(`✓ ${schema} enum enum_training_sync_log_source: creado`);
  } else {
    log(`· ${schema} enum enum_training_sync_log_source: ya existe`);
  }
  return true;
}

// ─── Fase B: ADD COLUMN + CREATE TABLE en transacción ──────────────────────

async function processSchemaInTx(s, t, schema) {
  // ── archived_at en training_users ──────────────────────────────────────
  if (!(await tableExists(s, t, schema, "training_users"))) {
    log(`· ${schema}.training_users: no existe, salto`);
    return;
  }

  if (!(await columnExists(s, t, schema, "training_users", "archived_at"))) {
    await s.query(
      `ALTER TABLE "${schema}"."training_users" ADD COLUMN "archived_at" TIMESTAMPTZ NULL`,
      { transaction: t }
    );
    log(`✓ ${schema}.training_users.archived_at: añadida`);
  } else {
    log(`· ${schema}.training_users.archived_at: ya existe`);
  }

  // ── training_sync_log ──────────────────────────────────────────────────
  if (!(await tableExists(s, t, schema, "training_sync_log"))) {
    await s.query(`
      CREATE TABLE "${schema}"."training_sync_log" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        source "${schema}"."enum_training_sync_log_source" NOT NULL,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        items_synced INTEGER NOT NULL DEFAULT 0,
        items_deactivated INTEGER NOT NULL DEFAULT 0,
        items_failed INTEGER NOT NULL DEFAULT 0,
        payload JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `, { transaction: t });
    log(`✓ ${schema}.training_sync_log: tabla creada`);
  } else {
    log(`· ${schema}.training_sync_log: ya existe`);
  }

  if (await tableExists(s, t, schema, "training_sync_log")) {
    if (!(await indexExists(s, t, schema, "training_sync_log_synced_at_idx"))) {
      await s.query(
        `CREATE INDEX "training_sync_log_synced_at_idx" ON "${schema}"."training_sync_log" (synced_at DESC)`,
        { transaction: t }
      );
      log(`✓ ${schema} index training_sync_log_synced_at_idx: creado`);
    } else {
      log(`· ${schema} index training_sync_log_synced_at_idx: ya existe`);
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function fetchTargetSlugs(s) {
  const [rows] = await s.query(
    `SELECT slug FROM master.tenants ORDER BY slug`
  );
  // Acotado si viene de `ensure-tenant-schema.js` (ONLY_SCHEMAS); global si se
  // lanza a mano, que es como se escribió. Ver scripts/_solo-este-tenant.js.
  return acotarSlugs(rows.map((r) => r.slug));
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: Training Sprint F3 — archive + sync_log  \n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: "postgres",
    logging: false,
  });

  try {
    const [versionRows] = await sequelize.query("SHOW server_version");
    log(`PostgreSQL: ${versionRows[0]?.server_version ?? "?"}`);

    header("Obteniendo lista de tenants activos...");
    const slugs = await fetchTargetSlugs(sequelize);
    if (slugs.length === 0) {
      log("· No hay tenants activos. Nada que hacer.");
      await sequelize.close();
      process.exit(0);
    }
    log(`✓ ${slugs.length} tenants: ${slugs.join(", ")}`);

    header("Fase A — CREATE TYPE de enums (autocommit)...");
    const schemasToProcess = [];
    for (const slug of slugs) {
      const schema = `crm_${slug}`;
      const hasTrainingTables = await createEnumsAutocommit(sequelize, schema);
      if (hasTrainingTables) schemasToProcess.push(schema);
    }

    if (schemasToProcess.length === 0) {
      process.stdout.write("\n· Ningún tenant tiene el módulo training instalado. Fin.\n\n");
      await sequelize.close();
      process.exit(0);
    }

    header("Fase B — ADD COLUMN + CREATE TABLE + índices (transacción global)...");
    await sequelize.transaction(async (t) => {
      for (const schema of schemasToProcess) {
        process.stdout.write(`\n· Schema ${schema}\n`);
        await processSchemaInTx(sequelize, t, schema);
      }
    });

    process.stdout.write("\n════════════════════════════════════════════════════\n");
    process.stdout.write(" ✓ Migración completada                              \n");
    process.stdout.write("════════════════════════════════════════════════════\n");
    process.stdout.write(" ℹ Schemas afectados: " + schemasToProcess.join(", ") + "\n");
    process.stdout.write("════════════════════════════════════════════════════\n\n");

    await sequelize.close();
    process.exit(0);
  } catch (err) {
    await sequelize.close();
    throw err;
  }
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") {
    process.stderr.write(`${err.stack}\n`);
  }
  process.exit(1);
});
