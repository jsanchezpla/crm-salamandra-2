/**
 * migrate-projects-sprint-1.js
 *
 * Sprint 1 del módulo Proyectos & Servicios (#3).
 *
 * Cambios:
 *   - projects: añade code, priority, due_date (rename desde end_date),
 *     completed_at, budget_amount, budget_currency, estimated_hours, tags,
 *     archived_at. Drop columns (JSONB) y assigned_to. Añade 'draft' al ENUM
 *     de status.
 *   - tasks: rename column_id (string) → board_column_id (UUID), rename
 *     assigned_to → assignee_id, añade phase_id, milestone_id, estimated_hours.
 *     Como `tasks` está vacía en local y producción no tiene proyectos
 *     activos, el cambio de tipo se hace con DROP+ADD.
 *   - leads: añade converted_project_id, converted_to_project_at.
 *   - costs e invoices: añade project_id (FK durmiente, sin uso en este sprint).
 *   - CREATE TABLE: phases, milestones, board_columns, project_members,
 *     project_templates.
 *
 * Estrategia:
 *   - Fase A en autocommit: ALTER TYPE enum_projects_status ADD VALUE 'draft'
 *     (PG <12 no permite usar ADD VALUE en la misma transacción).
 *   - Fase B en transacción global: CREATE TYPE para nuevos enums, ALTER TABLE,
 *     CREATE TABLE.
 *   - Idempotente. Lee slugs activos desde master.tenants.
 *
 * Uso:
 *   npm run db:migrate:projects-1         (local)
 *   npm run db:migrate:projects-1:prod    (producción)
 */

import { Sequelize } from "sequelize";

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
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
    { bind: [schema, table, column], transaction: t }
  );
  return rows.length > 0;
}

async function columnDataType(s, t, schema, table, column) {
  const [rows] = await s.query(
    `SELECT data_type FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
    { bind: [schema, table, column], transaction: t }
  );
  return rows[0]?.data_type ?? null;
}

async function enumTypeExists(s, t, enumTypeName, schema) {
  const [rows] = await s.query(
    `SELECT 1 FROM pg_type t
     JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE t.typname = $1 AND n.nspname = $2`,
    { bind: [enumTypeName, schema], transaction: t ?? undefined }
  );
  return rows.length > 0;
}

async function enumHasValue(s, enumTypeName, value, schema) {
  const [rows] = await s.query(
    `SELECT 1 FROM pg_enum e
     JOIN pg_type t ON t.oid = e.enumtypid
     JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE t.typname = $1 AND e.enumlabel = $2 AND n.nspname = $3`,
    { bind: [enumTypeName, value, schema] }
  );
  return rows.length > 0;
}

// ─── Fase A: ALTER TYPE en autocommit ──────────────────────────────────────

async function alterExistingEnums(s, schema) {
  if (await enumTypeExists(s, null, "enum_projects_status", schema)) {
    if (!(await enumHasValue(s, "enum_projects_status", "draft", schema))) {
      await s.query(
        `ALTER TYPE "${schema}"."enum_projects_status" ADD VALUE IF NOT EXISTS 'draft' BEFORE 'active'`
      );
      log(`✓ ${schema} enum projects.status: añadido 'draft'`);
    } else {
      log(`· ${schema} enum projects.status: 'draft' ya existe`);
    }
  } else {
    log(`· ${schema} enum projects.status: no existe (¿tabla projects ausente?)`);
  }
}

// ─── Fase B: CREATE TYPE, ALTER TABLE, CREATE TABLE en transacción ─────────

async function createEnumIfNotExists(s, t, schema, name, values) {
  if (await enumTypeExists(s, t, name, schema)) {
    log(`· ${schema} enum ${name}: ya existe`);
    return;
  }
  const valuesList = values.map((v) => `'${v}'`).join(", ");
  await s.query(`CREATE TYPE "${schema}"."${name}" AS ENUM (${valuesList})`, { transaction: t });
  log(`✓ ${schema} enum ${name}: creado`);
}

async function addColumnIfNotExists(s, t, schema, table, column, ddl) {
  if (!(await tableExists(s, t, schema, table))) {
    log(`· ${schema}.${table}: tabla no existe, salto ${column}`);
    return;
  }
  if (await columnExists(s, t, schema, table, column)) {
    log(`· ${schema}.${table}.${column}: ya existe`);
    return;
  }
  await s.query(`ALTER TABLE "${schema}"."${table}" ADD COLUMN "${column}" ${ddl}`, { transaction: t });
  log(`✓ ${schema}.${table}.${column}: añadida`);
}

async function dropColumnIfExists(s, t, schema, table, column) {
  if (!(await tableExists(s, t, schema, table))) return;
  if (!(await columnExists(s, t, schema, table, column))) {
    log(`· ${schema}.${table}.${column}: ya ausente`);
    return;
  }
  await s.query(`ALTER TABLE "${schema}"."${table}" DROP COLUMN "${column}"`, { transaction: t });
  log(`✓ ${schema}.${table}.${column}: eliminada`);
}

async function renameColumnIfNeeded(s, t, schema, table, oldName, newName) {
  if (!(await tableExists(s, t, schema, table))) return;
  if (await columnExists(s, t, schema, table, newName)) {
    log(`· ${schema}.${table}.${newName}: ya existe (rename ya hecho o no aplicable)`);
    return;
  }
  if (!(await columnExists(s, t, schema, table, oldName))) {
    log(`· ${schema}.${table}.${oldName}: no existe (no hay nada que renombrar)`);
    return;
  }
  await s.query(
    `ALTER TABLE "${schema}"."${table}" RENAME COLUMN "${oldName}" TO "${newName}"`,
    { transaction: t }
  );
  log(`✓ ${schema}.${table}: ${oldName} → ${newName}`);
}

async function processSchemaInTx(s, t, schema) {
  // ── ENUMs nuevos ───────────────────────────────────────────────────────
  await createEnumIfNotExists(s, t, schema, "enum_projects_priority", ["low", "medium", "high", "urgent"]);
  await createEnumIfNotExists(s, t, schema, "enum_milestones_status", ["pending", "completed", "missed"]);
  await createEnumIfNotExists(s, t, schema, "enum_project_members_role", ["lead", "member", "viewer"]);

  // ── projects: rename, drop, add ────────────────────────────────────────
  await renameColumnIfNeeded(s, t, schema, "projects", "end_date", "due_date");
  await dropColumnIfExists(s, t, schema, "projects", "columns");
  await dropColumnIfExists(s, t, schema, "projects", "assigned_to");

  await addColumnIfNotExists(s, t, schema, "projects", "code", `VARCHAR(32)`);
  // UNIQUE en code (parcial: NULLs no únicos)
  if (await tableExists(s, t, schema, "projects") && await columnExists(s, t, schema, "projects", "code")) {
    const [idx] = await s.query(
      `SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`,
      { bind: [schema, "projects_code_unique"], transaction: t }
    );
    if (idx.length === 0) {
      await s.query(
        `CREATE UNIQUE INDEX "projects_code_unique" ON "${schema}"."projects" (code) WHERE code IS NOT NULL`,
        { transaction: t }
      );
      log(`✓ ${schema} index projects_code_unique: creado`);
    } else {
      log(`· ${schema} index projects_code_unique: ya existe`);
    }
  }

  await addColumnIfNotExists(s, t, schema, "projects", "priority", `"${schema}"."enum_projects_priority" NOT NULL DEFAULT 'medium'`);
  await addColumnIfNotExists(s, t, schema, "projects", "completed_at", `TIMESTAMPTZ`);
  await addColumnIfNotExists(s, t, schema, "projects", "budget_amount", `NUMERIC(12,2)`);
  await addColumnIfNotExists(s, t, schema, "projects", "budget_currency", `VARCHAR(3) NOT NULL DEFAULT 'EUR'`);
  await addColumnIfNotExists(s, t, schema, "projects", "estimated_hours", `NUMERIC(10,2)`);
  await addColumnIfNotExists(s, t, schema, "projects", "tags", `JSONB NOT NULL DEFAULT '[]'`);
  await addColumnIfNotExists(s, t, schema, "projects", "archived_at", `TIMESTAMPTZ`);

  // Cambiar default de status a 'draft' (los registros existentes no se tocan)
  if (await tableExists(s, t, schema, "projects") && await columnExists(s, t, schema, "projects", "status")) {
    await s.query(
      `ALTER TABLE "${schema}"."projects" ALTER COLUMN status SET DEFAULT 'draft'`,
      { transaction: t }
    );
    log(`✓ ${schema}.projects.status: default 'draft'`);
  }

  // ── tasks: rename y add ────────────────────────────────────────────────
  // column_id es STRING legacy → drop y add board_column_id UUID. La tabla
  // está vacía en local y producción no tiene tasks (módulo projects
  // inactivo), así que no hay datos que migrar.
  if (await tableExists(s, t, schema, "tasks") && await columnExists(s, t, schema, "tasks", "column_id")) {
    const dataType = await columnDataType(s, t, schema, "tasks", "column_id");
    if (dataType !== "uuid") {
      await s.query(`ALTER TABLE "${schema}"."tasks" DROP COLUMN "column_id"`, { transaction: t });
      log(`✓ ${schema}.tasks.column_id: eliminada (legacy STRING)`);
    } else {
      log(`· ${schema}.tasks.column_id: ya es UUID (no esperado, revisar)`);
    }
  }
  await addColumnIfNotExists(s, t, schema, "tasks", "board_column_id", `UUID`);

  await renameColumnIfNeeded(s, t, schema, "tasks", "assigned_to", "assignee_id");

  await addColumnIfNotExists(s, t, schema, "tasks", "phase_id", `UUID`);
  await addColumnIfNotExists(s, t, schema, "tasks", "milestone_id", `UUID`);
  await addColumnIfNotExists(s, t, schema, "tasks", "estimated_hours", `NUMERIC(8,2)`);

  // ── leads: conversión a proyecto ───────────────────────────────────────
  await addColumnIfNotExists(s, t, schema, "leads", "converted_project_id", `UUID`);
  await addColumnIfNotExists(s, t, schema, "leads", "converted_to_project_at", `TIMESTAMPTZ`);

  // ── costs: FK durmiente projectId ──────────────────────────────────────
  await addColumnIfNotExists(s, t, schema, "costs", "project_id", `UUID`);

  // ── invoices: FK durmiente projectId ───────────────────────────────────
  await addColumnIfNotExists(s, t, schema, "invoices", "project_id", `UUID`);

  // ── phases ─────────────────────────────────────────────────────────────
  if (!(await tableExists(s, t, schema, "phases"))) {
    await s.query(`
      CREATE TABLE "${schema}"."phases" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL REFERENCES "${schema}"."projects"(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        "order" INTEGER NOT NULL,
        start_date DATE,
        end_date DATE,
        color VARCHAR(7),
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `, { transaction: t });
    await s.query(
      `CREATE UNIQUE INDEX "phases_project_order_unique" ON "${schema}"."phases" (project_id, "order")`,
      { transaction: t }
    );
    log(`✓ ${schema}.phases: tabla creada`);
  } else {
    log(`· ${schema}.phases: ya existe`);
  }

  // ── milestones ─────────────────────────────────────────────────────────
  if (!(await tableExists(s, t, schema, "milestones"))) {
    await s.query(`
      CREATE TABLE "${schema}"."milestones" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL REFERENCES "${schema}"."projects"(id) ON DELETE CASCADE,
        phase_id UUID REFERENCES "${schema}"."phases"(id) ON DELETE SET NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        due_date DATE NOT NULL,
        status "${schema}"."enum_milestones_status" NOT NULL DEFAULT 'pending',
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `, { transaction: t });
    log(`✓ ${schema}.milestones: tabla creada`);
  } else {
    log(`· ${schema}.milestones: ya existe`);
  }

  // ── board_columns ──────────────────────────────────────────────────────
  if (!(await tableExists(s, t, schema, "board_columns"))) {
    await s.query(`
      CREATE TABLE "${schema}"."board_columns" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL REFERENCES "${schema}"."projects"(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        "order" INTEGER NOT NULL,
        color VARCHAR(7),
        wip_limit INTEGER,
        is_done_column BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `, { transaction: t });
    await s.query(
      `CREATE UNIQUE INDEX "board_columns_project_order_unique" ON "${schema}"."board_columns" (project_id, "order")`,
      { transaction: t }
    );
    log(`✓ ${schema}.board_columns: tabla creada`);
  } else {
    log(`· ${schema}.board_columns: ya existe`);
  }

  // ── project_members ────────────────────────────────────────────────────
  if (!(await tableExists(s, t, schema, "project_members"))) {
    await s.query(`
      CREATE TABLE "${schema}"."project_members" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL REFERENCES "${schema}"."projects"(id) ON DELETE CASCADE,
        team_member_id UUID NOT NULL REFERENCES "${schema}"."team_members"(id) ON DELETE CASCADE,
        role "${schema}"."enum_project_members_role" NOT NULL DEFAULT 'member',
        joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `, { transaction: t });
    await s.query(
      `CREATE UNIQUE INDEX "project_members_project_team_unique" ON "${schema}"."project_members" (project_id, team_member_id)`,
      { transaction: t }
    );
    log(`✓ ${schema}.project_members: tabla creada`);
  } else {
    log(`· ${schema}.project_members: ya existe`);
  }

  // ── project_templates (sin FK a project) ───────────────────────────────
  if (!(await tableExists(s, t, schema, "project_templates"))) {
    await s.query(`
      CREATE TABLE "${schema}"."project_templates" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        phases JSONB NOT NULL DEFAULT '[]',
        board_columns JSONB NOT NULL DEFAULT '[]',
        default_milestones JSONB NOT NULL DEFAULT '[]',
        default_tags JSONB NOT NULL DEFAULT '[]',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `, { transaction: t });
    log(`✓ ${schema}.project_templates: tabla creada`);
  } else {
    log(`· ${schema}.project_templates: ya existe`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function fetchActiveSlugs(s) {
  const [rows] = await s.query(
    `SELECT slug FROM master.tenants WHERE status = 'active' ORDER BY slug`
  );
  return rows.map((r) => r.slug);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: Proyectos Sprint 1 (multi-tenant)        \n");
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
    const slugs = await fetchActiveSlugs(sequelize);
    if (slugs.length === 0) {
      log("· No hay tenants activos. Nada que hacer.");
      await sequelize.close();
      process.exit(0);
    }
    log(`✓ ${slugs.length} tenants: ${slugs.join(", ")}`);

    header("Fase A — ALTER TYPE de enums existentes (autocommit)...");
    for (const slug of slugs) {
      const schema = `crm_${slug}`;
      await alterExistingEnums(sequelize, schema);
    }

    header("Fase B — CREATE TYPE, ALTER/CREATE TABLE (transacción global)...");
    await sequelize.transaction(async (t) => {
      for (const slug of slugs) {
        const schema = `crm_${slug}`;
        process.stdout.write(`\n· Schema ${schema}\n`);
        await processSchemaInTx(sequelize, t, schema);
      }
    });

    process.stdout.write("\n════════════════════════════════════════════════════\n");
    process.stdout.write(" ✓ Migración completada                              \n");
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
