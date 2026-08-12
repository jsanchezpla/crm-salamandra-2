/**
 * migrate-sprint-aumenta-2026-07.js — Sprint Aumenta (reunión 28/07/2026).
 *
 * Aplica, por cada tenant activo y SOLO donde exista la tabla afectada:
 *   - payments: invoice_id nullable (cobros antes que facturas), client_id
 *     (backfill desde invoices), period_month + índices.
 *   - bookings: no_show_justified / no_show_reason (faltas de asistencia).
 *   - coordinations: scope (interna/externa) + external_entity.
 *   - clinic_sessions: prep_text / prep_files / parent_feedback (3 partes).
 *   - clinical_reports: valor 'referral' en el enum + delivered_document_id.
 *   - clients: guardians / portal_unlocked_months / contract_document_id.
 *   - incidencias: tabla incidencia_assignees (multi-responsable) + backfill.
 *   - tenants con patients: intervention_plans + contract_signatures.
 *   - tenants con bookings: blocked_days (festivos) + waitlist_entries
 *     (lista de espera de clientes).
 *
 * Idempotente (IF NOT EXISTS / comprobaciones previas). Todo en autocommit:
 * ALTER TYPE ... ADD VALUE no puede convivir con transacciones que usen el
 * valor nuevo, y cada sentencia es re-ejecutable por sí sola.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-sprint-aumenta-2026-07.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-sprint-aumenta-2026-07.js
 */

import { Sequelize } from "sequelize";
import { acotarSlugs } from "./_solo-este-tenant.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function schemaExists(s, schema) {
  const [rows] = await s.query(`SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`, { bind: [schema] });
  return rows.length > 0;
}
async function tableExists(s, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    { bind: [schema, table] }
  );
  return rows.length > 0;
}
async function columnIsNullable(s, schema, table, column) {
  const [rows] = await s.query(
    `SELECT is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
    { bind: [schema, table, column] }
  );
  return rows[0]?.is_nullable === "YES";
}
async function enumUdtOf(s, schema, table, column) {
  const [rows] = await s.query(
    `SELECT udt_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
    { bind: [schema, table, column] }
  );
  return rows[0]?.udt_name ?? null;
}
async function enumHasValue(s, schema, udtName, value) {
  const [rows] = await s.query(
    `SELECT 1 FROM pg_enum e
     JOIN pg_type tp ON tp.oid = e.enumtypid
     JOIN pg_namespace n ON n.oid = tp.typnamespace
     WHERE n.nspname = $1 AND tp.typname = $2 AND e.enumlabel = $3`,
    { bind: [schema, udtName, value] }
  );
  return rows.length > 0;
}
async function enumTypeExists(s, name, schema) {
  const [rows] = await s.query(
    `SELECT 1 FROM pg_type tp JOIN pg_namespace n ON n.oid = tp.typnamespace WHERE tp.typname = $1 AND n.nspname = $2`,
    { bind: [name, schema] }
  );
  return rows.length > 0;
}
async function indexExists(s, schema, indexName) {
  const [rows] = await s.query(`SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`, {
    bind: [schema, indexName],
  });
  return rows.length > 0;
}
async function ensureIndex(s, schema, indexName, table, colsSql, { unique = false } = {}) {
  if (await indexExists(s, schema, indexName)) return;
  await s.query(`CREATE ${unique ? "UNIQUE " : ""}INDEX "${indexName}" ON "${schema}"."${table}" ${colsSql}`);
  log(`✓ ${schema} index ${indexName}: creado`);
}
async function ensureUuidFn(s) {
  try { await s.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`); } catch { /* sin permiso */ }
  try { await s.query(`SELECT gen_random_uuid()`); return true; } catch { return false; }
}

async function fetchTargetSlugs(s) {
  const [rows] = await s.query(`SELECT slug FROM master.tenants ORDER BY slug`);
  // Acotado si viene de `ensure-tenant-schema.js` (ONLY_SCHEMAS); global si se
  // lanza a mano, que es como se escribió. Ver scripts/_solo-este-tenant.js.
  return acotarSlugs(rows.map((r) => r.slug));
}

// ── Bloques por tabla ────────────────────────────────────────────────────────

async function migratePayments(s, schema) {
  if (!(await tableExists(s, schema, "payments"))) return;
  if (!(await columnIsNullable(s, schema, "payments", "invoice_id"))) {
    await s.query(`ALTER TABLE "${schema}"."payments" ALTER COLUMN invoice_id DROP NOT NULL`);
    log(`✓ ${schema}.payments.invoice_id: ahora nullable`);
  }
  await s.query(`ALTER TABLE "${schema}"."payments" ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES "${schema}"."clients"(id) ON DELETE SET NULL`);
  await s.query(`ALTER TABLE "${schema}"."payments" ADD COLUMN IF NOT EXISTS period_month DATE`);
  // Backfill: el cobro hereda la clienta de su factura.
  const [, meta] = await s.query(
    `UPDATE "${schema}"."payments" p SET client_id = i.client_id
     FROM "${schema}"."invoices" i
     WHERE p.invoice_id = i.id AND p.client_id IS NULL AND i.client_id IS NOT NULL`
  );
  if (meta?.rowCount) log(`✓ ${schema}.payments: client_id backfill (${meta.rowCount} filas)`);
  await ensureIndex(s, schema, "payments_client_idx", "payments", "(client_id)");
  await ensureIndex(s, schema, "payments_period_idx", "payments", "(period_month)");
}

async function migrateBookings(s, schema) {
  if (!(await tableExists(s, schema, "bookings"))) return;
  await s.query(`ALTER TABLE "${schema}"."bookings" ADD COLUMN IF NOT EXISTS no_show_justified BOOLEAN`);
  await s.query(`ALTER TABLE "${schema}"."bookings" ADD COLUMN IF NOT EXISTS no_show_reason TEXT`);
}

async function migrateCoordinations(s, schema) {
  if (!(await tableExists(s, schema, "coordinations"))) return;
  if (!(await enumTypeExists(s, "enum_coordinations_scope", schema))) {
    await s.query(`CREATE TYPE "${schema}"."enum_coordinations_scope" AS ENUM ('internal', 'external')`);
    log(`✓ ${schema} enum enum_coordinations_scope: creado`);
  }
  await s.query(`ALTER TABLE "${schema}"."coordinations" ADD COLUMN IF NOT EXISTS scope "${schema}"."enum_coordinations_scope"`);
  await s.query(`ALTER TABLE "${schema}"."coordinations" ADD COLUMN IF NOT EXISTS external_entity VARCHAR(200)`);
}

async function migrateClinicSessions(s, schema) {
  if (!(await tableExists(s, schema, "clinic_sessions"))) return;
  await s.query(`ALTER TABLE "${schema}"."clinic_sessions" ADD COLUMN IF NOT EXISTS prep_text TEXT`);
  await s.query(`ALTER TABLE "${schema}"."clinic_sessions" ADD COLUMN IF NOT EXISTS prep_files JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await s.query(`ALTER TABLE "${schema}"."clinic_sessions" ADD COLUMN IF NOT EXISTS parent_feedback TEXT`);
}

async function migrateClinicalReports(s, schema) {
  if (!(await tableExists(s, schema, "clinical_reports"))) return;
  const udt = await enumUdtOf(s, schema, "clinical_reports", "report_type");
  if (udt && !(await enumHasValue(s, schema, udt, "referral"))) {
    await s.query(`ALTER TYPE "${schema}"."${udt}" ADD VALUE IF NOT EXISTS 'referral'`);
    log(`✓ ${schema}.clinical_reports.report_type: valor 'referral' añadido`);
  }
  await s.query(`ALTER TABLE "${schema}"."clinical_reports" ADD COLUMN IF NOT EXISTS delivered_document_id UUID`);
}

async function migrateClients(s, schema) {
  if (!(await tableExists(s, schema, "clients"))) return;
  await s.query(`ALTER TABLE "${schema}"."clients" ADD COLUMN IF NOT EXISTS guardians JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await s.query(`ALTER TABLE "${schema}"."clients" ADD COLUMN IF NOT EXISTS portal_unlocked_months JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await s.query(`ALTER TABLE "${schema}"."clients" ADD COLUMN IF NOT EXISTS contract_document_id UUID`);
}

async function migrateIncidenciaAssignees(s, schema, uuidDefault) {
  if (!(await tableExists(s, schema, "incidencias"))) return;
  const idCol = `id UUID PRIMARY KEY${uuidDefault ? " DEFAULT gen_random_uuid()" : ""}`;
  if (!(await tableExists(s, schema, "incidencia_assignees"))) {
    await s.query(
      `CREATE TABLE "${schema}"."incidencia_assignees" (
        ${idCol},
        incidencia_id UUID NOT NULL REFERENCES "${schema}"."incidencias"(id) ON DELETE CASCADE,
        team_member_id UUID NOT NULL REFERENCES "${schema}"."team_members"(id) ON DELETE CASCADE,
        assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    );
    log(`✓ ${schema}.incidencia_assignees: tabla creada`);
  }
  await ensureIndex(s, schema, "incidencia_assignees_unique", "incidencia_assignees", "(incidencia_id, team_member_id)", { unique: true });
  await ensureIndex(s, schema, "incidencia_assignees_team_member_idx", "incidencia_assignees", "(team_member_id)");
  // Backfill: el responsable único actual pasa a ser el primero de la lista.
  const [, meta] = await s.query(
    `INSERT INTO "${schema}"."incidencia_assignees" (id, incidencia_id, team_member_id, assigned_at, created_at, updated_at)
     SELECT gen_random_uuid(), i.id, i.assigned_to_id, now(), now(), now()
     FROM "${schema}"."incidencias" i
     WHERE i.assigned_to_id IS NOT NULL
     ON CONFLICT (incidencia_id, team_member_id) DO NOTHING`
  );
  if (meta?.rowCount) log(`✓ ${schema}.incidencia_assignees: backfill (${meta.rowCount} filas)`);
}

async function migrateInterventionPlans(s, schema, uuidDefault) {
  if (!(await tableExists(s, schema, "patients"))) return;
  const idCol = `id UUID PRIMARY KEY${uuidDefault ? " DEFAULT gen_random_uuid()" : ""}`;
  if (!(await tableExists(s, schema, "intervention_plans"))) {
    await s.query(
      `CREATE TABLE "${schema}"."intervention_plans" (
        ${idCol},
        patient_id UUID NOT NULL REFERENCES "${schema}"."patients"(id) ON DELETE CASCADE,
        diagnosis TEXT,
        consultation_reasons TEXT,
        previous_info TEXT,
        objectives JSONB NOT NULL DEFAULT '[]'::jsonb,
        activity_types JSONB NOT NULL DEFAULT '[]'::jsonb,
        methodologies JSONB NOT NULL DEFAULT '[]'::jsonb,
        report_schedule JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by_id UUID REFERENCES "${schema}"."team_members"(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    );
    log(`✓ ${schema}.intervention_plans: tabla creada`);
  }
  await ensureIndex(s, schema, "intervention_plans_patient_unique", "intervention_plans", "(patient_id)", { unique: true });
}

async function migrateContractSignatures(s, schema, uuidDefault) {
  if (!(await tableExists(s, schema, "patients")) || !(await tableExists(s, schema, "clients"))) return;
  const idCol = `id UUID PRIMARY KEY${uuidDefault ? " DEFAULT gen_random_uuid()" : ""}`;
  if (!(await tableExists(s, schema, "contract_signatures"))) {
    await s.query(
      `CREATE TABLE "${schema}"."contract_signatures" (
        ${idCol},
        client_id UUID NOT NULL REFERENCES "${schema}"."clients"(id) ON DELETE CASCADE,
        guardian_id UUID NOT NULL,
        signer_name VARCHAR(200) NOT NULL,
        signature_path VARCHAR(500) NOT NULL,
        signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ip VARCHAR(64),
        user_agent VARCHAR(255),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    );
    log(`✓ ${schema}.contract_signatures: tabla creada`);
  }
  await ensureIndex(s, schema, "contract_signatures_unique", "contract_signatures", "(client_id, guardian_id)", { unique: true });
}

async function migrateBlockedDays(s, schema, uuidDefault) {
  if (!(await tableExists(s, schema, "bookings"))) return;
  const idCol = `id UUID PRIMARY KEY${uuidDefault ? " DEFAULT gen_random_uuid()" : ""}`;
  if (!(await tableExists(s, schema, "blocked_days"))) {
    await s.query(
      `CREATE TABLE "${schema}"."blocked_days" (
        ${idCol},
        date DATE NOT NULL,
        label VARCHAR(120),
        created_by_id UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    );
    log(`✓ ${schema}.blocked_days: tabla creada`);
  }
  await ensureIndex(s, schema, "blocked_days_date_unique", "blocked_days", "(date)", { unique: true });
}

async function migrateWaitlist(s, schema, uuidDefault) {
  if (!(await tableExists(s, schema, "bookings"))) return;
  if (!(await enumTypeExists(s, "enum_waitlist_entries_status", schema))) {
    await s.query(`CREATE TYPE "${schema}"."enum_waitlist_entries_status" AS ENUM ('active', 'converted', 'removed')`);
    log(`✓ ${schema} enum enum_waitlist_entries_status: creado`);
  }
  const idCol = `id UUID PRIMARY KEY${uuidDefault ? " DEFAULT gen_random_uuid()" : ""}`;
  if (!(await tableExists(s, schema, "waitlist_entries"))) {
    const clientFk = (await tableExists(s, schema, "clients"))
      ? ` REFERENCES "${schema}"."clients"(id) ON DELETE SET NULL`
      : "";
    await s.query(
      `CREATE TABLE "${schema}"."waitlist_entries" (
        ${idCol},
        name VARCHAR(200) NOT NULL,
        phone VARCHAR(50),
        email VARCHAR(255),
        specialty VARCHAR(40),
        notes TEXT,
        status "${schema}"."enum_waitlist_entries_status" NOT NULL DEFAULT 'active',
        position INTEGER NOT NULL,
        client_id UUID${clientFk},
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    );
    log(`✓ ${schema}.waitlist_entries: tabla creada`);
  }
  await ensureIndex(s, schema, "waitlist_entries_status_position_idx", "waitlist_entries", "(status, position)");
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function processSchema(s, schema, uuidDefault) {
  await migratePayments(s, schema);
  await migrateBookings(s, schema);
  await migrateCoordinations(s, schema);
  await migrateClinicSessions(s, schema);
  await migrateClinicalReports(s, schema);
  await migrateClients(s, schema);
  await migrateIncidenciaAssignees(s, schema, uuidDefault);
  await migrateInterventionPlans(s, schema, uuidDefault);
  await migrateContractSignatures(s, schema, uuidDefault);
  await migrateBlockedDays(s, schema, uuidDefault);
  await migrateWaitlist(s, schema, uuidDefault);
  log(`✓ ${schema}: listo`);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: Sprint Aumenta (reunión 28/07/2026)\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const sequelize = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const slugs = await fetchTargetSlugs(sequelize);
  if (slugs.length === 0) {
    log("· Ningún tenant activo.");
    await sequelize.close();
    process.exit(0);
  }
  log(`✓ ${slugs.length} tenants: ${slugs.join(", ")}`);
  const uuidDefault = await ensureUuidFn(sequelize);

  for (const slug of slugs) {
    const schema = `crm_${slug}`;
    header(`Tenant ${slug} (${schema})`);
    if (!(await schemaExists(sequelize, schema))) {
      log(`✗ schema ${schema} no existe, se salta`);
      continue;
    }
    try {
      await processSchema(sequelize, schema, uuidDefault);
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
