/**
 * migrate-incentive-items.js — incentivos ESCRITOS a mano (módulo Clínica).
 *
 * Crea, en cada tenant con módulo `clinica` o `pacientes` activo:
 *   - enum enum_incentive_items_value_type ('fixed' | 'percent');
 *   - tabla `incentive_items`: concepto concreto ("Cambiar la bombilla del
 *     centro") asignado a una terapeuta y un mes, con valor en € o en % del
 *     sueldo mensual (foto del importe en resolved_amount).
 *
 * FKs: therapist_id → team_members ON DELETE CASCADE (sin terapeuta el item no
 * significa nada); created_by_id → team_members SET NULL.
 *
 * Idempotente. Selecciona tenants leyendo master.tenants en runtime (regla #12).
 * La relanza `ensure-tenant-schema.js` cuando un tenant estrena clinica.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-incentive-items.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-incentive-items.js
 */

import { Sequelize } from "sequelize";
import { acotarSlugs } from "./_solo-este-tenant.js";

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
async function fetchTargetSlugs(s) {
  const [rows] = await s.query(`
    SELECT DISTINCT t.slug
    FROM master.tenants t
    JOIN master.tenant_modules tm ON tm.tenant_id = t.id
    WHERE tm.enabled = TRUE AND tm.module_key IN ('clinica','pacientes')
    ORDER BY t.slug
  `);
  // Acotado si viene de `ensure-tenant-schema.js` (ONLY_SCHEMAS); global si se
  // lanza a mano, que es como se escribió. Ver scripts/_solo-este-tenant.js.
  return acotarSlugs(rows.map((r) => r.slug));
}
async function ensureUuidFn(s) {
  try { await s.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`); } catch { /* sin permiso */ }
  try { await s.query(`SELECT gen_random_uuid()`); return true; } catch { return false; }
}
async function ensureIndex(s, t, schema, indexName, table, colsSql) {
  if (await indexExists(s, t, schema, indexName)) return;
  await s.query(`CREATE INDEX "${indexName}" ON "${schema}"."${table}" ${colsSql}`, { transaction: t });
  log(`✓ ${schema} index ${indexName}: creado`);
}

async function processSchema(s, schema) {
  if (!(await tableExists(s, null, schema, "team_members"))) {
    log(`✗ ${schema}: no existe team_members. Se salta.`);
    return;
  }
  const uuidDefault = await ensureUuidFn(s);
  const enumName = "enum_incentive_items_value_type";
  if (!(await enumTypeExists(s, enumName, schema))) {
    await s.query(`CREATE TYPE "${schema}"."${enumName}" AS ENUM ('fixed', 'percent')`);
    log(`✓ ${schema} enum ${enumName}: creado`);
  }
  await s.transaction(async (t) => {
    const idCol = `id UUID PRIMARY KEY${uuidDefault ? " DEFAULT gen_random_uuid()" : ""}`;
    if (!(await tableExists(s, t, schema, "incentive_items"))) {
      await s.query(
        `CREATE TABLE "${schema}"."incentive_items" (
          ${idCol},
          therapist_id UUID NOT NULL REFERENCES "${schema}"."team_members"(id) ON DELETE CASCADE,
          period_month INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
          period_year INTEGER NOT NULL CHECK (period_year BETWEEN 2020 AND 2100),
          concept VARCHAR(200) NOT NULL,
          value_type "${schema}"."${enumName}" NOT NULL DEFAULT 'fixed',
          value DECIMAL(8,2) NOT NULL CHECK (value >= 0),
          resolved_amount DECIMAL(8,2) CHECK (resolved_amount >= 0),
          salary_base DECIMAL(10,2),
          created_by_id UUID REFERENCES "${schema}"."team_members"(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
        { transaction: t }
      );
      log(`✓ ${schema}.incentive_items: tabla creada`);
    } else {
      log(`· ${schema}.incentive_items: ya existe`);
    }
    await ensureIndex(s, t, schema, "incentive_items_therapist_period_idx", "incentive_items", "(therapist_id, period_year, period_month)");
    await ensureIndex(s, t, schema, "incentive_items_period_idx", "incentive_items", "(period_year, period_month)");
  });
  log(`✓ ${schema}: listo`);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: incentive_items (incentivos escritos)\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const sequelize = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const slugs = await fetchTargetSlugs(sequelize);
  if (slugs.length === 0) {
    log("· Ningún tenant con clinica/pacientes activo.");
    await sequelize.close();
    process.exit(0);
  }
  log(`✓ ${slugs.length} tenants: ${slugs.join(", ")}`);

  for (const slug of slugs) {
    const schema = `crm_${slug}`;
    header(`Tenant ${slug} (${schema})`);
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
