/**
 * migrate-notifications-table.js — crea la tabla `notifications` (modelo
 * Notification, hasta ahora durmiente) en TODOS los schemas crm_*.
 *
 * Es transversal (cualquier tenant puede tener notificaciones "app"); de momento
 * la usa el sistema de alertas de Clínica (informes vencidos, incidencias
 * asignadas). Sin FK: `user_id` es referencia lógica a master.users.
 *
 * Idempotente (CREATE ... IF NOT EXISTS + comprobaciones). Aditiva. Va en CORE.
 * Índice único parcial (user_id, type, entity_id) para deduplicar las alertas
 * automáticas por entidad.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-notifications-table.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-notifications-table.js
 */

import { Sequelize } from "sequelize";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function listSchemas(s) {
  const [rows] = await s.query(
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'crm_%' ORDER BY schema_name`
  );
  return rows.map((r) => r.schema_name);
}
async function tableExists(s, t, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    { bind: [schema, table], transaction: t }
  );
  return rows.length > 0;
}
async function indexExists(s, t, schema, indexName) {
  const [rows] = await s.query(`SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`, {
    bind: [schema, indexName],
    transaction: t,
  });
  return rows.length > 0;
}
async function enumTypeExists(s, name, schema) {
  const [rows] = await s.query(
    `SELECT 1 FROM pg_type tp JOIN pg_namespace n ON n.oid = tp.typnamespace WHERE tp.typname = $1 AND n.nspname = $2`,
    { bind: [name, schema] }
  );
  return rows.length > 0;
}
async function ensureUuidFn(s) {
  try { await s.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`); } catch { /* sin permiso */ }
  try { await s.query(`SELECT gen_random_uuid()`); return true; } catch { return false; }
}
async function ensureIndex(s, t, schema, indexName, sql) {
  if (await indexExists(s, t, schema, indexName)) return;
  await s.query(sql, { transaction: t });
  log(`✓ ${schema} index ${indexName}: creado`);
}

async function processSchema(s, schema, uuidDefault) {
  const enumName = "enum_notifications_channel";
  if (!(await enumTypeExists(s, enumName, schema))) {
    await s.query(`CREATE TYPE "${schema}"."${enumName}" AS ENUM ('app', 'email', 'sms')`);
    log(`✓ ${schema} enum ${enumName}: creado`);
  }
  await s.transaction(async (t) => {
    const idCol = `id UUID PRIMARY KEY${uuidDefault ? " DEFAULT gen_random_uuid()" : ""}`;
    if (!(await tableExists(s, t, schema, "notifications"))) {
      await s.query(
        `CREATE TABLE "${schema}"."notifications" (
          ${idCol},
          user_id UUID NOT NULL,
          channel "${schema}"."${enumName}" NOT NULL DEFAULT 'app',
          type VARCHAR(255) NOT NULL,
          title VARCHAR(255) NOT NULL,
          body TEXT,
          read BOOLEAN NOT NULL DEFAULT FALSE,
          read_at TIMESTAMPTZ,
          entity_type VARCHAR(255),
          entity_id UUID,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
        { transaction: t }
      );
      log(`✓ ${schema}.notifications: tabla creada`);
    } else {
      log(`· ${schema}.notifications: ya existe`);
    }
    await ensureIndex(s, t, schema, "notifications_user_read_idx",
      `CREATE INDEX "notifications_user_read_idx" ON "${schema}"."notifications" (user_id, read)`);
    await ensureIndex(s, t, schema, "notifications_user_created_idx",
      `CREATE INDEX "notifications_user_created_idx" ON "${schema}"."notifications" (user_id, created_at)`);
    await ensureIndex(s, t, schema, "notifications_dedupe_uniq",
      `CREATE UNIQUE INDEX "notifications_dedupe_uniq" ON "${schema}"."notifications" (user_id, type, entity_id) WHERE entity_id IS NOT NULL`);
  });
  log(`✓ ${schema}: listo`);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: tabla notifications (todos crm_*)\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  const uuidDefault = await ensureUuidFn(s);

  const schemas = await listSchemas(s);
  if (schemas.length === 0) {
    log("· No hay schemas crm_*.");
    await s.close();
    process.exit(0);
  }
  log(`✓ ${schemas.length} schemas: ${schemas.join(", ")}`);

  for (const schema of schemas) {
    header(`Schema ${schema}`);
    try {
      await processSchema(s, schema, uuidDefault);
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
