/**
 * migrate-clinica-module.js — Fase 1 (backend real) de Clínica + Pacientes.
 *
 * Generaliza las viejas migraciones aumenta-only (migrate-clinica-sprint-1.js +
 * migrate-pacientes-sprint-1.js) a CUALQUIER tenant con el módulo activo, leyendo
 * la lista de `master.tenants` en runtime (regla #12). Idempotente.
 *
 * Para cada tenant con `clinica` o `pacientes` activado:
 *   - Fase A (autocommit): pgcrypto + enums. Crea los enums que falten y AÑADE a
 *     enum_clinic_sessions_status los valores nuevos ('ai_pending','registered').
 *   - Fase B (transacción): crea (IF NOT EXISTS) patients, clinic_sessions,
 *     coordinations, clinical_reports, performance_metrics — con las FK ya a
 *     `patients` (nada de client_id: los tenants nuevos nacen correctos). Y añade
 *     las columnas nuevas a tablas ya existentes:
 *       · patients.objectives            JSONB DEFAULT '[]'
 *       · clinic_sessions.audio_duration_sec INTEGER
 *       · clinic_sessions.ai_reviewed_at     TIMESTAMPTZ
 *
 * NO activa módulos (procesa solo tenants que YA los tienen activos) y NO re-apunta
 * client_id→patient_id (eso fue el paso histórico de aumenta; los tenants nuevos
 * ya nacen con patient_id). Un tenant heredado que solo corrió la migración vieja
 * de Clínica (tablas con client_id, sin patients) necesitaría el paso de
 * re-apuntado de migrate-pacientes-sprint-1.js — hoy solo aplica a aumenta.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-clinica-module.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-clinica-module.js
 */

import { Sequelize } from "sequelize";
import { acotarSlugs } from "./_solo-este-tenant.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

// ─── Introspección ──────────────────────────────────────────────────────────

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
async function columnExists(s, t, schema, table, column) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
    { bind: [schema, table, column], transaction: t }
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
  // Acotado si viene de `ensure-tenant-schema.js` (ONLY_SCHEMAS); global si se
  // lanza a mano, que es como se escribió. Ver scripts/_solo-este-tenant.js.
  return acotarSlugs(rows.map((r) => r.slug));
}

// gen_random_uuid() es nativa desde PG13; en PG12 la aporta pgcrypto. Si no se
// puede garantizar, se omite el DEFAULT y Sequelize/seed generan el UUID en JS.
async function ensureUuidFn(s) {
  try {
    await s.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  } catch {
    /* sin permiso para crear extensiones — seguimos e intentamos detectar */
  }
  try {
    await s.query(`SELECT gen_random_uuid()`);
    return true;
  } catch {
    return false;
  }
}

async function ensureIndex(s, t, schema, indexName, table, colsSql, unique = false) {
  if (await indexExists(s, t, schema, indexName)) return;
  await s.query(
    `CREATE ${unique ? "UNIQUE " : ""}INDEX "${indexName}" ON "${schema}"."${table}" ${colsSql}`,
    { transaction: t }
  );
  log(`✓ ${schema} index ${indexName}: creado`);
}

// ─── Fase A: enums ──────────────────────────────────────────────────────────

async function ensureEnums(s, schema) {
  const simple = [
    { name: "enum_patients_status", values: ["active", "paused", "discharged"] },
    {
      name: "enum_coordinations_coordination_type",
      values: ["family", "school", "psychiatrist", "neuropediatrician", "other_therapist", "orientator", "other"],
    },
    { name: "enum_clinical_reports_report_type", values: ["evolution", "admission", "discharge"] },
    { name: "enum_clinical_reports_status", values: ["draft", "reviewed", "delivered"] },
  ];
  for (const e of simple) {
    if (!(await enumTypeExists(s, e.name, schema))) {
      await s.query(`CREATE TYPE "${schema}"."${e.name}" AS ENUM (${e.values.map((v) => `'${v}'`).join(", ")})`);
      log(`✓ ${schema} enum ${e.name}: creado`);
    }
  }
  // clinic_sessions status: fresco con los 4 valores; existente → añade los nuevos.
  const sess = "enum_clinic_sessions_status";
  if (!(await enumTypeExists(s, sess, schema))) {
    await s.query(`CREATE TYPE "${schema}"."${sess}" AS ENUM ('draft', 'ai_pending', 'registered', 'published')`);
    log(`✓ ${schema} enum ${sess}: creado (4 valores)`);
  } else {
    for (const v of ["ai_pending", "registered"]) {
      await s.query(`ALTER TYPE "${schema}"."${sess}" ADD VALUE IF NOT EXISTS '${v}'`);
    }
    log(`· ${schema} enum ${sess}: valores nuevos garantizados (ai_pending, registered)`);
  }
}

// ─── Fase B: tablas + columnas nuevas ───────────────────────────────────────

async function ensureTables(s, t, schema, uuidDefault) {
  const idCol = `id UUID PRIMARY KEY${uuidDefault ? " DEFAULT gen_random_uuid()" : ""}`;

  // ── patients ──
  if (!(await tableExists(s, t, schema, "patients"))) {
    await s.query(
      `CREATE TABLE "${schema}"."patients" (
        ${idCol},
        first_name VARCHAR(120) NOT NULL,
        last_name VARCHAR(120) NOT NULL,
        birth_date DATE,
        age INTEGER CHECK (age BETWEEN 0 AND 120),
        education_center VARCHAR(200),
        education_level VARCHAR(80),
        referral_reason TEXT,
        referred_by VARCHAR(120),
        objectives JSONB NOT NULL DEFAULT '[]'::jsonb,
        main_therapist_id UUID REFERENCES "${schema}"."team_members"(id) ON DELETE SET NULL,
        enrollment_date DATE,
        attendance_frequency VARCHAR(50),
        status "${schema}"."enum_patients_status" NOT NULL DEFAULT 'active',
        discharge_date DATE,
        discharge_reason TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      { transaction: t }
    );
    log(`✓ ${schema}.patients: tabla creada`);
  } else if (!(await columnExists(s, t, schema, "patients", "objectives"))) {
    await s.query(`ALTER TABLE "${schema}"."patients" ADD COLUMN objectives JSONB NOT NULL DEFAULT '[]'::jsonb`, { transaction: t });
    log(`✓ ${schema}.patients: columna objectives añadida`);
  }
  await ensureIndex(s, t, schema, "patients_name_idx", "patients", "(last_name, first_name)");
  await ensureIndex(s, t, schema, "patients_therapist_idx", "patients", "(main_therapist_id)");
  await ensureIndex(s, t, schema, "patients_status_idx", "patients", "(status)");

  // ── clinic_sessions ──
  if (!(await tableExists(s, t, schema, "clinic_sessions"))) {
    await s.query(
      `CREATE TABLE "${schema}"."clinic_sessions" (
        ${idCol},
        patient_id UUID NOT NULL REFERENCES "${schema}"."patients"(id) ON DELETE RESTRICT,
        therapist_id UUID NOT NULL REFERENCES "${schema}"."team_members"(id) ON DELETE RESTRICT,
        session_date TIMESTAMPTZ NOT NULL,
        duration INTEGER,
        objectives JSONB NOT NULL DEFAULT '[]'::jsonb,
        activities TEXT,
        performance TEXT,
        observations JSONB NOT NULL DEFAULT '{}'::jsonb,
        ai_transcription TEXT,
        ai_structured JSONB,
        audio_duration_sec INTEGER,
        ai_reviewed_at TIMESTAMPTZ,
        status "${schema}"."enum_clinic_sessions_status" NOT NULL DEFAULT 'registered',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      { transaction: t }
    );
    log(`✓ ${schema}.clinic_sessions: tabla creada`);
  } else {
    for (const [col, ddl] of [
      ["audio_duration_sec", "INTEGER"],
      ["ai_reviewed_at", "TIMESTAMPTZ"],
    ]) {
      if (!(await columnExists(s, t, schema, "clinic_sessions", col))) {
        await s.query(`ALTER TABLE "${schema}"."clinic_sessions" ADD COLUMN ${col} ${ddl}`, { transaction: t });
        log(`✓ ${schema}.clinic_sessions: columna ${col} añadida`);
      }
    }
  }
  await ensureIndex(s, t, schema, "clinic_sessions_patient_date_idx", "clinic_sessions", "(patient_id, session_date)");
  await ensureIndex(s, t, schema, "clinic_sessions_therapist_date_idx", "clinic_sessions", "(therapist_id, session_date)");

  // ── coordinations ──
  if (!(await tableExists(s, t, schema, "coordinations"))) {
    await s.query(
      `CREATE TABLE "${schema}"."coordinations" (
        ${idCol},
        coordination_type "${schema}"."enum_coordinations_coordination_type" NOT NULL,
        participants JSONB NOT NULL DEFAULT '[]'::jsonb,
        coordination_date TIMESTAMPTZ NOT NULL,
        topics JSONB NOT NULL DEFAULT '[]'::jsonb,
        agreements JSONB NOT NULL DEFAULT '[]'::jsonb,
        next_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
        related_patient_id UUID REFERENCES "${schema}"."patients"(id) ON DELETE SET NULL,
        ai_transcription TEXT,
        ai_acta_generated TEXT,
        created_by_id UUID NOT NULL REFERENCES "${schema}"."team_members"(id) ON DELETE RESTRICT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      { transaction: t }
    );
    log(`✓ ${schema}.coordinations: tabla creada`);
  }
  await ensureIndex(s, t, schema, "coordinations_date_idx", "coordinations", "(coordination_date)");
  await ensureIndex(s, t, schema, "coordinations_patient_idx", "coordinations", "(related_patient_id)");
  await ensureIndex(s, t, schema, "coordinations_creator_idx", "coordinations", "(created_by_id)");

  // ── clinical_reports ──
  if (!(await tableExists(s, t, schema, "clinical_reports"))) {
    await s.query(
      `CREATE TABLE "${schema}"."clinical_reports" (
        ${idCol},
        patient_id UUID NOT NULL REFERENCES "${schema}"."patients"(id) ON DELETE RESTRICT,
        therapist_id UUID NOT NULL REFERENCES "${schema}"."team_members"(id) ON DELETE RESTRICT,
        report_type "${schema}"."enum_clinical_reports_report_type" NOT NULL DEFAULT 'evolution',
        report_date DATE NOT NULL,
        delivered_at TIMESTAMPTZ,
        due_date DATE,
        ai_generated TEXT,
        content_sections JSONB NOT NULL DEFAULT '{}'::jsonb,
        attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
        status "${schema}"."enum_clinical_reports_status" NOT NULL DEFAULT 'draft',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      { transaction: t }
    );
    log(`✓ ${schema}.clinical_reports: tabla creada`);
  }
  await ensureIndex(s, t, schema, "clinical_reports_patient_date_idx", "clinical_reports", "(patient_id, report_date)");
  await ensureIndex(s, t, schema, "clinical_reports_therapist_date_idx", "clinical_reports", "(therapist_id, report_date)");
  await ensureIndex(s, t, schema, "clinical_reports_status_due_idx", "clinical_reports", "(status, due_date)");

  // ── performance_metrics ──
  if (!(await tableExists(s, t, schema, "performance_metrics"))) {
    await s.query(
      `CREATE TABLE "${schema}"."performance_metrics" (
        ${idCol},
        therapist_id UUID NOT NULL REFERENCES "${schema}"."team_members"(id) ON DELETE CASCADE,
        period_month INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
        period_year INTEGER NOT NULL CHECK (period_year BETWEEN 2020 AND 2100),
        area1_score INTEGER CHECK (area1_score BETWEEN 0 AND 100),
        area2_score INTEGER CHECK (area2_score BETWEEN 0 AND 100),
        area3_score INTEGER CHECK (area3_score BETWEEN 0 AND 100),
        area4_score INTEGER CHECK (area4_score BETWEEN 0 AND 100),
        area6_score INTEGER CHECK (area6_score BETWEEN 0 AND 100),
        area7_score INTEGER CHECK (area7_score BETWEEN 0 AND 100),
        area8_score INTEGER CHECK (area8_score BETWEEN 0 AND 100),
        complement_occupation INTEGER CHECK (complement_occupation BETWEEN 0 AND 100),
        complement_seniority INTEGER CHECK (complement_seniority >= 0),
        complement_attendance BOOLEAN,
        total_score INTEGER CHECK (total_score BETWEEN 0 AND 100),
        proposed_incentive DECIMAL(8,2) CHECK (proposed_incentive >= 0),
        approved_incentive DECIMAL(8,2) CHECK (approved_incentive >= 0),
        approved_by_id UUID REFERENCES "${schema}"."team_members"(id) ON DELETE SET NULL,
        approved_at TIMESTAMPTZ,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      { transaction: t }
    );
    log(`✓ ${schema}.performance_metrics: tabla creada`);
  }
  await ensureIndex(s, t, schema, "performance_metrics_therapist_period_unique", "performance_metrics", "(therapist_id, period_year, period_month)", true);
  await ensureIndex(s, t, schema, "performance_metrics_period_idx", "performance_metrics", "(period_year, period_month)");
}

async function processSchema(s, schema) {
  if (!(await tableExists(s, null, schema, "team_members"))) {
    log(`✗ ${schema}: no existe team_members (¿módulo team?). Se salta este tenant.`);
    return;
  }
  const uuidDefault = await ensureUuidFn(s);
  await ensureEnums(s, schema); // autocommit (enums no van en la transacción)
  await s.transaction(async (t) => {
    await ensureTables(s, t, schema, uuidDefault);
  });
  log(`✓ ${schema}: listo`);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: Clínica + Pacientes (backend real, Fase 1)\n");
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
