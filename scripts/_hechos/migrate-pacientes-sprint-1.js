/**
 * migrate-pacientes-sprint-1.js
 *
 * Sprint 1 (visual / maqueta) del módulo Pacientes — complementario al Sprint 1
 * de Clínica ya implementado. Solo schema crm_aumenta.
 *
 * Cambios:
 *   - CREATE TYPE enum_patients_status
 *   - CREATE TABLE patients (estructura pediátrica completa) + índices + FK
 *     a team_members
 *   - ALTER las 3 tablas del módulo Clínica para que apunten a `patients` en
 *     vez de `clients`:
 *       · clinic_sessions:   drop FK client_id  → add patient_id NOT NULL FK
 *       · coordinations:     drop FK related_client_id → add related_patient_id FK
 *       · clinical_reports:  drop FK client_id  → add patient_id NOT NULL FK
 *     Idempotente. Verifica que las 3 tablas están vacías antes de drop
 *     (no hay datos reales en Sprint 1 visual). Si tienen filas, ABORTA.
 *   - Activa el módulo 'pacientes' en master.tenant_modules para aumenta.
 *
 * Estrategia:
 *   - Fase A (autocommit): CREATE TYPE.
 *   - Fase B (transacción): CREATE TABLE patients.
 *   - Fase C (transacción): ALTER tablas Clínica (drop/add FKs).
 *   - Fase D (transacción): activar módulo.
 *
 * Uso:
 *   npm run db:migrate:pacientes         (local)
 *   npm run db:migrate:pacientes:prod    (producción)
 */

import { Sequelize } from "sequelize";

const TARGET_SLUG = "aumenta";
const SCHEMA = `crm_${TARGET_SLUG}`;
const MODULE_KEY = "pacientes";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

// ─── Helpers ───────────────────────────────────────────────────────────────

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

async function constraintExists(s, t, schema, table, constraintName) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.table_constraints
     WHERE table_schema = $1 AND table_name = $2 AND constraint_name = $3`,
    { bind: [schema, table, constraintName], transaction: t }
  );
  return rows.length > 0;
}

async function countRows(s, t, schema, table) {
  const [rows] = await s.query(`SELECT COUNT(*)::int AS c FROM "${schema}"."${table}"`, { transaction: t });
  return rows[0].c;
}

async function schemaExists(s, schema) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
    { bind: [schema] }
  );
  return rows.length > 0;
}

// ─── Fase A ────────────────────────────────────────────────────────────────

async function createEnumsAutocommit(s, schema) {
  if (!(await enumTypeExists(s, null, "enum_patients_status", schema))) {
    await s.query(
      `CREATE TYPE "${schema}"."enum_patients_status" AS ENUM ('active', 'paused', 'discharged')`
    );
    log(`✓ ${schema} enum enum_patients_status: creado`);
  } else {
    log(`· ${schema} enum enum_patients_status: ya existe`);
  }
}

// ─── Fase B ────────────────────────────────────────────────────────────────

async function createPatientsTable(s, t, schema) {
  if (!(await tableExists(s, t, schema, "patients"))) {
    await s.query(
      `
      CREATE TABLE "${schema}"."patients" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        first_name VARCHAR(120) NOT NULL,
        last_name VARCHAR(120) NOT NULL,
        birth_date DATE,
        age INTEGER CHECK (age BETWEEN 0 AND 120),
        education_center VARCHAR(200),
        education_level VARCHAR(80),
        referral_reason TEXT,
        referred_by VARCHAR(120),
        main_therapist_id UUID REFERENCES "${schema}"."team_members"(id) ON DELETE SET NULL,
        enrollment_date DATE,
        attendance_frequency VARCHAR(50),
        status "${schema}"."enum_patients_status" NOT NULL DEFAULT 'active',
        discharge_date DATE,
        discharge_reason TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
      `,
      { transaction: t }
    );
    log(`✓ ${schema}.patients: tabla creada`);
  } else {
    log(`· ${schema}.patients: ya existe`);
  }

  if (!(await indexExists(s, t, schema, "patients_name_idx"))) {
    await s.query(
      `CREATE INDEX "patients_name_idx" ON "${schema}"."patients" (last_name, first_name)`,
      { transaction: t }
    );
    log(`✓ ${schema} index patients_name_idx: creado`);
  } else {
    log(`· ${schema} index patients_name_idx: ya existe`);
  }
  if (!(await indexExists(s, t, schema, "patients_therapist_idx"))) {
    await s.query(
      `CREATE INDEX "patients_therapist_idx" ON "${schema}"."patients" (main_therapist_id)`,
      { transaction: t }
    );
    log(`✓ ${schema} index patients_therapist_idx: creado`);
  } else {
    log(`· ${schema} index patients_therapist_idx: ya existe`);
  }
  if (!(await indexExists(s, t, schema, "patients_status_idx"))) {
    await s.query(
      `CREATE INDEX "patients_status_idx" ON "${schema}"."patients" (status)`,
      { transaction: t }
    );
    log(`✓ ${schema} index patients_status_idx: creado`);
  } else {
    log(`· ${schema} index patients_status_idx: ya existe`);
  }
}

// ─── Fase C: re-apuntar FKs Clínica de clients → patients ──────────────────

async function dropOldClientFkAndIndex(s, t, schema, table, columnName, indexName) {
  // Buscar el nombre del constraint FK que apunta a clients via la columna
  const [rows] = await s.query(
    `SELECT tc.constraint_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type = 'FOREIGN KEY' AND kcu.column_name = $3`,
    { bind: [schema, table, columnName], transaction: t }
  );
  for (const r of rows) {
    await s.query(
      `ALTER TABLE "${schema}"."${table}" DROP CONSTRAINT IF EXISTS "${r.constraint_name}"`,
      { transaction: t }
    );
    log(`✓ ${schema}.${table}: FK ${r.constraint_name} eliminada`);
  }

  if (indexName && (await indexExists(s, t, schema, indexName))) {
    await s.query(`DROP INDEX IF EXISTS "${schema}"."${indexName}"`, { transaction: t });
    log(`✓ ${schema} index ${indexName}: eliminado (de la versión anterior)`);
  }

  if (await columnExists(s, t, schema, table, columnName)) {
    await s.query(`ALTER TABLE "${schema}"."${table}" DROP COLUMN "${columnName}"`, { transaction: t });
    log(`✓ ${schema}.${table}: columna ${columnName} eliminada`);
  } else {
    log(`· ${schema}.${table}: columna ${columnName} ya no existe (idempotente)`);
  }
}

async function addPatientFk(s, t, schema, table, columnName, notNull, indexName) {
  if (!(await columnExists(s, t, schema, table, columnName))) {
    const nullClause = notNull ? "NOT NULL" : "";
    const onDelete = notNull ? "RESTRICT" : "SET NULL";
    await s.query(
      `ALTER TABLE "${schema}"."${table}" ADD COLUMN "${columnName}" UUID ${nullClause} REFERENCES "${schema}"."patients"(id) ON DELETE ${onDelete}`,
      { transaction: t }
    );
    log(`✓ ${schema}.${table}: columna ${columnName} añadida con FK a patients`);
  } else {
    log(`· ${schema}.${table}: columna ${columnName} ya existe`);
  }

  if (indexName && !(await indexExists(s, t, schema, indexName))) {
    const cols = table === "clinic_sessions" ? `(${columnName}, session_date)` :
                 table === "clinical_reports" ? `(${columnName}, report_date)` :
                 `(${columnName})`;
    await s.query(
      `CREATE INDEX "${indexName}" ON "${schema}"."${table}" ${cols}`,
      { transaction: t }
    );
    log(`✓ ${schema} index ${indexName}: creado`);
  } else if (indexName) {
    log(`· ${schema} index ${indexName}: ya existe`);
  }
}

async function repointClinicaFks(s, t, schema) {
  const tables = [
    { name: "clinic_sessions", oldCol: "client_id", oldIdx: "clinic_sessions_client_date_idx",
      newCol: "patient_id", newIdx: "clinic_sessions_patient_date_idx", notNull: true },
    { name: "coordinations", oldCol: "related_client_id", oldIdx: "coordinations_client_idx",
      newCol: "related_patient_id", newIdx: "coordinations_patient_idx", notNull: false },
    { name: "clinical_reports", oldCol: "client_id", oldIdx: "clinical_reports_client_date_idx",
      newCol: "patient_id", newIdx: "clinical_reports_patient_date_idx", notNull: true },
  ];

  for (const tbl of tables) {
    if (!(await tableExists(s, t, schema, tbl.name))) {
      log(`· ${schema}.${tbl.name}: tabla no existe (Sprint Clínica no ejecutado), saltando`);
      continue;
    }
    const rowCount = await countRows(s, t, schema, tbl.name);
    if (rowCount > 0) {
      throw new Error(
        `${schema}.${tbl.name} tiene ${rowCount} filas. El sprint visual asume tabla vacía. ` +
        `Aborta — confirma con el usuario si hay que migrar datos.`
      );
    }
    log(`▸ ${schema}.${tbl.name}: ${rowCount} filas, procediendo`);
    await dropOldClientFkAndIndex(s, t, schema, tbl.name, tbl.oldCol, tbl.oldIdx);
    await addPatientFk(s, t, schema, tbl.name, tbl.newCol, tbl.notNull, tbl.newIdx);
  }
}

// ─── Fase D: activar módulo ────────────────────────────────────────────────

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
  process.stdout.write(" Migración: Pacientes Sprint 1 (solo aumenta)        \n");
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

    header("Fase B — CREATE TABLE patients (transacción)...");
    await sequelize.transaction(async (t) => {
      await createPatientsTable(sequelize, t, SCHEMA);
    });

    header("Fase C — Re-apuntar FKs de Clínica (clients → patients)...");
    await sequelize.transaction(async (t) => {
      await repointClinicaFks(sequelize, t, SCHEMA);
    });

    header("Fase D — Activar módulo en master.tenant_modules...");
    await sequelize.transaction(async (t) => {
      await activateModule(sequelize, t);
    });

    process.stdout.write("\n════════════════════════════════════════════════════\n");
    process.stdout.write(" ✓ Migración completada                              \n");
    process.stdout.write("════════════════════════════════════════════════════\n");
    process.stdout.write(` Módulo 'pacientes' activo en tenant '${TARGET_SLUG}'.\n`);
    process.stdout.write(" Las sesiones, informes y coordinaciones de Clínica  \n");
    process.stdout.write(" ahora referencian 'patients' en vez de 'clients'.   \n");
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
