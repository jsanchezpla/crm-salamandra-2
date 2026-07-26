/**
 * migrate-incidencias-module.js — Sistema de incidencias (Programa de Excelencia).
 *
 * Crea, en cada tenant con módulo `clinica` o `pacientes` activo:
 *   - enums enum_incidencias_category / _status / _priority (nombres que casan
 *     con los ENUM del modelo Incidencia);
 *   - tabla `incidencias` (IF NOT EXISTS) con FKs nullable ON DELETE SET NULL a
 *     patients / clients / team_members.
 *
 * Idempotente. Selecciona tenants leyendo master.tenants en runtime (regla #12).
 * La relanza `ensure-tenant-schema.js` cuando un tenant estrena clinica.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-incidencias-module.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-incidencias-module.js
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
    WHERE t.status = 'active' AND tm.enabled = TRUE AND tm.module_key IN ('clinica','pacientes')
    ORDER BY t.slug
  `);
  return rows.map((r) => r.slug);
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

async function ensureEnums(s, schema) {
  const enums = [
    { name: "enum_incidencias_category", values: ["terapeutica", "organizativa", "documental", "administrativa", "tecnologica", "comunicativa", "coordinacion", "informacion"] },
    { name: "enum_incidencias_status", values: ["pending", "in_progress", "resolved"] },
    { name: "enum_incidencias_priority", values: ["low", "medium", "high"] },
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
  if (!(await tableExists(s, t, schema, "incidencias"))) {
    await s.query(
      `CREATE TABLE "${schema}"."incidencias" (
        ${idCol},
        incidence_date DATE NOT NULL,
        title VARCHAR(200) NOT NULL,
        description TEXT,
        category "${schema}"."enum_incidencias_category" NOT NULL,
        subcategory VARCHAR(120),
        status "${schema}"."enum_incidencias_status" NOT NULL DEFAULT 'pending',
        priority "${schema}"."enum_incidencias_priority" NOT NULL DEFAULT 'medium',
        patient_id UUID REFERENCES "${schema}"."patients"(id) ON DELETE SET NULL,
        client_id UUID REFERENCES "${schema}"."clients"(id) ON DELETE SET NULL,
        assigned_to_id UUID REFERENCES "${schema}"."team_members"(id) ON DELETE SET NULL,
        reported_by_id UUID REFERENCES "${schema}"."team_members"(id) ON DELETE SET NULL,
        comments JSONB NOT NULL DEFAULT '[]'::jsonb,
        resolution TEXT,
        resolved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      { transaction: t }
    );
    log(`✓ ${schema}.incidencias: tabla creada`);
  } else {
    log(`· ${schema}.incidencias: ya existe`);
  }
  await ensureIndex(s, t, schema, "incidencias_status_idx", "incidencias", "(status)");
  await ensureIndex(s, t, schema, "incidencias_category_idx", "incidencias", "(category)");
  await ensureIndex(s, t, schema, "incidencias_patient_idx", "incidencias", "(patient_id)");
  await ensureIndex(s, t, schema, "incidencias_assigned_idx", "incidencias", "(assigned_to_id)");
  await ensureIndex(s, t, schema, "incidencias_date_idx", "incidencias", "(incidence_date)");
}

async function processSchema(s, schema) {
  if (!(await tableExists(s, null, schema, "patients"))) {
    log(`✗ ${schema}: no existe patients (¿módulo clinica?). Se salta.`);
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
  process.stdout.write(" Migración: Incidencias (Programa de Excelencia)\n");
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
