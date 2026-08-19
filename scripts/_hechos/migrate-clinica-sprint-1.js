/**
 * migrate-clinica-sprint-1.js
 *
 * Sprint 1 (visual / maqueta) del módulo Clínica.
 *
 * Cambios:
 *   - CREATE TYPE enums: enum_clinic_sessions_status,
 *     enum_coordinations_coordination_type,
 *     enum_clinical_reports_report_type,
 *     enum_clinical_reports_status
 *   - CREATE TABLE: clinic_sessions, coordinations, clinical_reports,
 *     performance_metrics
 *   - Activa el módulo 'clinica' en master.tenant_modules para aumenta
 *     (enabled=true, version=1.0.0).
 *
 * Estrategia:
 *   - Solo procesa el schema crm_aumenta (hardcoded). El módulo Clínica es
 *     específico de Aumenta; otros tenants no lo necesitan.
 *   - Fase A en autocommit: CREATE TYPE de enums (Postgres no permite ADD
 *     VALUE en la misma transacción).
 *   - Fase B en transacción global: CREATE TABLE IF NOT EXISTS + índices + FKs.
 *   - Fase C: activar el módulo en master.tenant_modules.
 *   - Idempotente.
 *
 * Uso:
 *   npm run db:migrate:clinica         (local)
 *   npm run db:migrate:clinica:prod    (producción — pendiente de coordinar)
 */

import { Sequelize } from "sequelize";

const TARGET_SLUG = "aumenta";
const SCHEMA = `crm_${TARGET_SLUG}`;
const MODULE_KEY = "clinica";

function log(msg) {
  process.stdout.write(`  ${msg}\n`);
}
function header(msg) {
  process.stdout.write(`\n▶ ${msg}\n`);
}

// ─── Helpers de introspección ──────────────────────────────────────────────

async function tableExists(s, t, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    { bind: [schema, table], transaction: t }
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

async function schemaExists(s, schema) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
    { bind: [schema] }
  );
  return rows.length > 0;
}

// ─── Fase A: CREATE TYPE en autocommit ─────────────────────────────────────

async function createEnumsAutocommit(s, schema) {
  const enums = [
    {
      name: "enum_clinic_sessions_status",
      values: ["draft", "published"],
    },
    {
      name: "enum_coordinations_coordination_type",
      values: [
        "family",
        "school",
        "psychiatrist",
        "neuropediatrician",
        "other_therapist",
        "orientator",
        "other",
      ],
    },
    {
      name: "enum_clinical_reports_report_type",
      values: ["evolution", "admission", "discharge"],
    },
    {
      name: "enum_clinical_reports_status",
      values: ["draft", "reviewed", "delivered"],
    },
  ];

  for (const e of enums) {
    if (!(await enumTypeExists(s, null, e.name, schema))) {
      const valuesSql = e.values.map((v) => `'${v}'`).join(", ");
      await s.query(`CREATE TYPE "${schema}"."${e.name}" AS ENUM (${valuesSql})`);
      log(`✓ ${schema} enum ${e.name}: creado`);
    } else {
      log(`· ${schema} enum ${e.name}: ya existe`);
    }
  }
}

// ─── Fase B: CREATE TABLE en transacción ───────────────────────────────────

async function createTables(s, t, schema) {
  // ── clinic_sessions ──────────────────────────────────────────────────────
  if (!(await tableExists(s, t, schema, "clinic_sessions"))) {
    await s.query(
      `
      CREATE TABLE "${schema}"."clinic_sessions" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id UUID NOT NULL REFERENCES "${schema}"."clients"(id) ON DELETE CASCADE,
        therapist_id UUID NOT NULL REFERENCES "${schema}"."team_members"(id) ON DELETE RESTRICT,
        session_date TIMESTAMPTZ NOT NULL,
        duration INTEGER,
        objectives JSONB NOT NULL DEFAULT '[]'::jsonb,
        activities TEXT,
        performance TEXT,
        observations JSONB NOT NULL DEFAULT '{}'::jsonb,
        ai_transcription TEXT,
        ai_structured JSONB,
        status "${schema}"."enum_clinic_sessions_status" NOT NULL DEFAULT 'published',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `,
      { transaction: t }
    );
    log(`✓ ${schema}.clinic_sessions: tabla creada`);
  } else {
    log(`· ${schema}.clinic_sessions: ya existe`);
  }

  if (!(await indexExists(s, t, schema, "clinic_sessions_client_date_idx"))) {
    await s.query(
      `CREATE INDEX "clinic_sessions_client_date_idx" ON "${schema}"."clinic_sessions" (client_id, session_date)`,
      { transaction: t }
    );
    log(`✓ ${schema} index clinic_sessions_client_date_idx: creado`);
  } else {
    log(`· ${schema} index clinic_sessions_client_date_idx: ya existe`);
  }
  if (!(await indexExists(s, t, schema, "clinic_sessions_therapist_date_idx"))) {
    await s.query(
      `CREATE INDEX "clinic_sessions_therapist_date_idx" ON "${schema}"."clinic_sessions" (therapist_id, session_date)`,
      { transaction: t }
    );
    log(`✓ ${schema} index clinic_sessions_therapist_date_idx: creado`);
  } else {
    log(`· ${schema} index clinic_sessions_therapist_date_idx: ya existe`);
  }

  // ── coordinations ────────────────────────────────────────────────────────
  if (!(await tableExists(s, t, schema, "coordinations"))) {
    await s.query(
      `
      CREATE TABLE "${schema}"."coordinations" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        coordination_type "${schema}"."enum_coordinations_coordination_type" NOT NULL,
        participants JSONB NOT NULL DEFAULT '[]'::jsonb,
        coordination_date TIMESTAMPTZ NOT NULL,
        topics JSONB NOT NULL DEFAULT '[]'::jsonb,
        agreements JSONB NOT NULL DEFAULT '[]'::jsonb,
        next_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
        related_client_id UUID REFERENCES "${schema}"."clients"(id) ON DELETE SET NULL,
        ai_transcription TEXT,
        ai_acta_generated TEXT,
        created_by_id UUID NOT NULL REFERENCES "${schema}"."team_members"(id) ON DELETE RESTRICT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `,
      { transaction: t }
    );
    log(`✓ ${schema}.coordinations: tabla creada`);
  } else {
    log(`· ${schema}.coordinations: ya existe`);
  }

  if (!(await indexExists(s, t, schema, "coordinations_date_idx"))) {
    await s.query(
      `CREATE INDEX "coordinations_date_idx" ON "${schema}"."coordinations" (coordination_date)`,
      { transaction: t }
    );
    log(`✓ ${schema} index coordinations_date_idx: creado`);
  } else {
    log(`· ${schema} index coordinations_date_idx: ya existe`);
  }
  if (!(await indexExists(s, t, schema, "coordinations_client_idx"))) {
    await s.query(
      `CREATE INDEX "coordinations_client_idx" ON "${schema}"."coordinations" (related_client_id)`,
      { transaction: t }
    );
    log(`✓ ${schema} index coordinations_client_idx: creado`);
  } else {
    log(`· ${schema} index coordinations_client_idx: ya existe`);
  }
  if (!(await indexExists(s, t, schema, "coordinations_creator_idx"))) {
    await s.query(
      `CREATE INDEX "coordinations_creator_idx" ON "${schema}"."coordinations" (created_by_id)`,
      { transaction: t }
    );
    log(`✓ ${schema} index coordinations_creator_idx: creado`);
  } else {
    log(`· ${schema} index coordinations_creator_idx: ya existe`);
  }

  // ── clinical_reports ─────────────────────────────────────────────────────
  if (!(await tableExists(s, t, schema, "clinical_reports"))) {
    await s.query(
      `
      CREATE TABLE "${schema}"."clinical_reports" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id UUID NOT NULL REFERENCES "${schema}"."clients"(id) ON DELETE CASCADE,
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
      )
    `,
      { transaction: t }
    );
    log(`✓ ${schema}.clinical_reports: tabla creada`);
  } else {
    log(`· ${schema}.clinical_reports: ya existe`);
  }

  if (!(await indexExists(s, t, schema, "clinical_reports_client_date_idx"))) {
    await s.query(
      `CREATE INDEX "clinical_reports_client_date_idx" ON "${schema}"."clinical_reports" (client_id, report_date)`,
      { transaction: t }
    );
    log(`✓ ${schema} index clinical_reports_client_date_idx: creado`);
  } else {
    log(`· ${schema} index clinical_reports_client_date_idx: ya existe`);
  }
  if (!(await indexExists(s, t, schema, "clinical_reports_therapist_date_idx"))) {
    await s.query(
      `CREATE INDEX "clinical_reports_therapist_date_idx" ON "${schema}"."clinical_reports" (therapist_id, report_date)`,
      { transaction: t }
    );
    log(`✓ ${schema} index clinical_reports_therapist_date_idx: creado`);
  } else {
    log(`· ${schema} index clinical_reports_therapist_date_idx: ya existe`);
  }
  if (!(await indexExists(s, t, schema, "clinical_reports_status_due_idx"))) {
    await s.query(
      `CREATE INDEX "clinical_reports_status_due_idx" ON "${schema}"."clinical_reports" (status, due_date)`,
      { transaction: t }
    );
    log(`✓ ${schema} index clinical_reports_status_due_idx: creado`);
  } else {
    log(`· ${schema} index clinical_reports_status_due_idx: ya existe`);
  }

  // ── performance_metrics ──────────────────────────────────────────────────
  if (!(await tableExists(s, t, schema, "performance_metrics"))) {
    await s.query(
      `
      CREATE TABLE "${schema}"."performance_metrics" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
      )
    `,
      { transaction: t }
    );
    log(`✓ ${schema}.performance_metrics: tabla creada`);
  } else {
    log(`· ${schema}.performance_metrics: ya existe`);
  }

  if (!(await indexExists(s, t, schema, "performance_metrics_therapist_period_unique"))) {
    await s.query(
      `CREATE UNIQUE INDEX "performance_metrics_therapist_period_unique" ON "${schema}"."performance_metrics" (therapist_id, period_year, period_month)`,
      { transaction: t }
    );
    log(`✓ ${schema} index performance_metrics_therapist_period_unique: creado`);
  } else {
    log(`· ${schema} index performance_metrics_therapist_period_unique: ya existe`);
  }
  if (!(await indexExists(s, t, schema, "performance_metrics_period_idx"))) {
    await s.query(
      `CREATE INDEX "performance_metrics_period_idx" ON "${schema}"."performance_metrics" (period_year, period_month)`,
      { transaction: t }
    );
    log(`✓ ${schema} index performance_metrics_period_idx: creado`);
  } else {
    log(`· ${schema} index performance_metrics_period_idx: ya existe`);
  }
}

// ─── Fase C: activar módulo en master.tenant_modules ───────────────────────

async function activateModule(s, t) {
  const [tenantRows] = await s.query(
    `SELECT id FROM master.tenants WHERE slug = $1`,
    { bind: [TARGET_SLUG], transaction: t }
  );
  if (tenantRows.length === 0) {
    throw new Error(`Tenant '${TARGET_SLUG}' no existe en master.tenants. Aborta.`);
  }
  const tenantId = tenantRows[0].id;

  const [existing] = await s.query(
    `SELECT id, enabled FROM master.tenant_modules WHERE tenant_id = $1 AND module_key = $2`,
    { bind: [tenantId, MODULE_KEY], transaction: t }
  );

  if (existing.length === 0) {
    await s.query(
      `INSERT INTO master.tenant_modules
        (id, tenant_id, module_key, enabled, version, schema_extensions, logic_overrides, feature_flags, created_at, updated_at)
       VALUES
        (gen_random_uuid(), $1, $2, true, '1.0.0', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, now(), now())`,
      { bind: [tenantId, MODULE_KEY], transaction: t }
    );
    log(`✓ master.tenant_modules: activado '${MODULE_KEY}' para tenant '${TARGET_SLUG}'`);
  } else if (existing[0].enabled !== true) {
    await s.query(
      `UPDATE master.tenant_modules SET enabled = true, updated_at = now() WHERE id = $1`,
      { bind: [existing[0].id], transaction: t }
    );
    log(`✓ master.tenant_modules: reactivado '${MODULE_KEY}' para tenant '${TARGET_SLUG}'`);
  } else {
    log(`· master.tenant_modules: '${MODULE_KEY}' ya está activo para tenant '${TARGET_SLUG}'`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: Clínica Sprint 1 (solo aumenta)          \n");
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

    header(`Verificando schema ${SCHEMA}...`);
    if (!(await schemaExists(sequelize, SCHEMA))) {
      process.stderr.write(`\n✗ Schema ${SCHEMA} no existe. ¿Tenant '${TARGET_SLUG}' creado?\n`);
      await sequelize.close();
      process.exit(1);
    }
    log(`✓ Schema ${SCHEMA} existe`);

    header("Fase A — CREATE TYPE de enums (autocommit)...");
    await createEnumsAutocommit(sequelize, SCHEMA);

    header("Fase B — CREATE TABLE + índices (transacción global)...");
    await sequelize.transaction(async (t) => {
      await createTables(sequelize, t, SCHEMA);
    });

    header("Fase C — Activar módulo en master.tenant_modules...");
    await sequelize.transaction(async (t) => {
      await activateModule(sequelize, t);
    });

    process.stdout.write("\n════════════════════════════════════════════════════\n");
    process.stdout.write(" ✓ Migración completada                              \n");
    process.stdout.write("════════════════════════════════════════════════════\n");
    process.stdout.write(` Módulo 'clinica' activo en tenant '${TARGET_SLUG}'.\n`);
    process.stdout.write(" Sprint 1: solo maqueta visual. Frontend con datos   \n");
    process.stdout.write(" dummy hardcoded. Sin endpoints CRUD ni IA.          \n");
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
