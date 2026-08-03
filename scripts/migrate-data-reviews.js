/**
 * migrate-data-reviews.js — tabla `data_reviews`: «esto ya lo he mirado».
 *
 * La usa la pantalla «Fichas a completar» (`/clientes/urgentes`) para archivar
 * los huecos que son CORRECTOS —un paciente en lista de espera no tiene
 * terapeuta y no es un error—, de modo que las carpetas puedan llegar a cero.
 * Sin eso, la pantalla no se vacía nunca y deja de mirarla todo el mundo.
 *
 * Aditiva e idempotente. No-op en schemas sin `clients`.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-data-reviews.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-data-reviews.js
 */

import { Sequelize } from "sequelize";

function log(m) { process.stdout.write(`  ${m}\n`); }

async function listSchemas(s) {
  const [rows] = await s.query(
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'crm_%' ORDER BY schema_name`
  );
  return rows.map((r) => r.schema_name);
}
async function tableExists(s, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2`,
    { bind: [schema, table] }
  );
  return rows.length > 0;
}
async function ensureUuidFn(s) {
  try { await s.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`); } catch { /* sin permiso */ }
  try { await s.query(`SELECT gen_random_uuid()`); return true; } catch { return false; }
}

async function processSchema(s, schema, uuidDefault) {
  if (!(await tableExists(s, schema, "clients"))) {
    log(`· ${schema}: sin clientes, se salta`);
    return;
  }
  if (await tableExists(s, schema, "data_reviews")) {
    log(`· ${schema}: data_reviews ya existía`);
    return;
  }

  await s.query(`
    CREATE TABLE "${schema}"."data_reviews" (
      id             UUID PRIMARY KEY ${uuidDefault ? "DEFAULT gen_random_uuid()" : ""},
      check_key      VARCHAR(60) NOT NULL,
      entity_id      UUID NOT NULL,
      entity_type    VARCHAR(20) NOT NULL,
      reviewed_by_id UUID,
      note           TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Archivar dos veces el mismo hueco no significa nada.
  await s.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS "data_reviews_check_entity_unique" ON "${schema}"."data_reviews" (check_key, entity_id)`
  );
  await s.query(`CREATE INDEX IF NOT EXISTS "data_reviews_check_idx" ON "${schema}"."data_reviews" (check_key)`);
  log(`✓ ${schema}: data_reviews creada`);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { process.stderr.write("Falta DATABASE_URL\n"); process.exit(1); }

  const s = new Sequelize(url, { logging: false });
  try {
    await s.authenticate();
    const uuidDefault = await ensureUuidFn(s);
    const schemas = await listSchemas(s);
    process.stdout.write(`\n▶ Marcas de «ya revisado» · ${schemas.length} schema(s)\n\n`);
    for (const schema of schemas) await processSchema(s, schema, uuidDefault);
    process.stdout.write("\n✓ Migración completada\n\n");
  } finally {
    await s.close();
  }
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err?.message ?? err}\n`);
  process.exit(1);
});
