/**
 * migrate-auditorias-module.js — Auditoría mensual de desempeño (módulo
 * `auditorias`, 09/09/2026, AV-0100).
 *
 * Crea, en cada tenant con el módulo `auditorias` activo:
 *   - enums enum_auditorias_desempeno_resultado / _estado (nombres que casan
 *     con los ENUM del modelo AuditoriaDesempeno);
 *   - tabla `auditorias_desempeno` (IF NOT EXISTS) con FKs a team_members
 *     (ON DELETE SET NULL en el auditor, CASCADE en el auditado: la auditoría
 *     de alguien que ya no está no le sirve a nadie sin la persona);
 *   - índice ÚNICO por (team_member_id, mes): una persona, un mes, una
 *     auditoría.
 *
 * Idempotente. Selecciona tenants leyendo master.tenants en runtime (regla #12).
 * La relanza `ensure-tenant-schema.js` cuando un tenant estrena `auditorias`.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-auditorias-module.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-auditorias-module.js
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
    WHERE tm.enabled = TRUE AND tm.module_key = 'auditorias'
    ORDER BY t.slug
  `);
  return acotarSlugs(rows.map((r) => r.slug));
}

async function ensureUuidFn(s) {
  try { await s.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`); } catch { /* sin permiso */ }
  try { await s.query(`SELECT gen_random_uuid()`); return true; } catch { return false; }
}

async function ensureIndex(s, t, schema, indexName, table, colsSql, unico = false) {
  if (await indexExists(s, t, schema, indexName)) return;
  await s.query(`CREATE${unico ? " UNIQUE" : ""} INDEX "${indexName}" ON "${schema}"."${table}" ${colsSql}`, { transaction: t });
  log(`✓ ${schema} index ${indexName}: creado`);
}

async function ensureEnums(s, schema) {
  const enums = [
    { name: "enum_auditorias_desempeno_resultado", values: ["favorable", "requiereSeguimiento"] },
    { name: "enum_auditorias_desempeno_estado", values: ["borrador", "cerrada"] },
  ];
  for (const e of enums) {
    if (!(await enumTypeExists(s, e.name, schema))) {
      await s.query(`CREATE TYPE "${schema}"."${e.name}" AS ENUM (${e.values.map((v) => `'${v}'`).join(", ")})`);
      log(`✓ ${schema} enum ${e.name}: creado`);
    }
  }
}

async function ensureTable(s, t, schema, uuidDefault) {
  const idCol = `id UUID PRIMARY KEY${uuidDefault ? " DEFAULT gen_random_uuid()" : ""}`;
  if (!(await tableExists(s, t, schema, "auditorias_desempeno"))) {
    await s.query(
      `CREATE TABLE "${schema}"."auditorias_desempeno" (
        ${idCol},
        team_member_id UUID NOT NULL REFERENCES "${schema}"."team_members"(id) ON DELETE CASCADE,
        auditor_id UUID REFERENCES "${schema}"."team_members"(id) ON DELETE SET NULL,
        mes VARCHAR(7) NOT NULL,
        fecha DATE,
        areas JSONB NOT NULL DEFAULT '[]'::jsonb,
        fortalezas TEXT,
        aspectos_a_mejorar TEXT,
        accion_acordada TEXT,
        plazo_revision DATE,
        observaciones TEXT,
        resultado "${schema}"."enum_auditorias_desempeno_resultado",
        resuelto_lo_anterior TEXT,
        pacientes_revisados JSONB NOT NULL DEFAULT '[]'::jsonb,
        estado "${schema}"."enum_auditorias_desempeno_estado" NOT NULL DEFAULT 'borrador',
        cerrada_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      { transaction: t }
    );
    log(`✓ ${schema}.auditorias_desempeno: tabla creada`);
  } else {
    log(`· ${schema}.auditorias_desempeno: ya existe`);
  }
  await ensureIndex(s, t, schema, "auditorias_desempeno_member_idx", "auditorias_desempeno", "(team_member_id)");
  await ensureIndex(s, t, schema, "auditorias_desempeno_mes_idx", "auditorias_desempeno", "(mes)");
  await ensureIndex(s, t, schema, "auditorias_desempeno_unica", "auditorias_desempeno", "(team_member_id, mes)", true);
}

async function processSchema(s, schema) {
  if (!(await tableExists(s, null, schema, "team_members"))) {
    log(`✗ ${schema}: no existe team_members (¿módulo team?). Se salta.`);
    return;
  }
  const uuidDefault = await ensureUuidFn(s);
  await ensureEnums(s, schema); // autocommit
  await s.transaction(async (t) => {
    await ensureTable(s, t, schema, uuidDefault);
  });
  log(`✓ ${schema}: listo`);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: Auditoría de desempeño\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const sequelize = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const slugs = await fetchTargetSlugs(sequelize);
  if (slugs.length === 0) {
    log("· Ningún tenant con `auditorias` activo.");
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
  process.stderr.write(`\n✗ ${err.message}\n`);
  process.exit(1);
});
