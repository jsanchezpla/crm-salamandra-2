/**
 * migrate-projects-sprint-2.js
 *
 * Sprint 2 del módulo Proyectos (#3) — Tablero Kanban.
 *
 * Cambios:
 *   - CREATE TABLE task_assignees (N-a-N tareas ↔ team_members) con UNIQUE
 *     (task_id, team_member_id) e índice por team_member_id.
 *   - Migrar tasks.assignee_id (legacy 1-a-1) a task_assignees. NO se elimina
 *     la columna en esta migración (rollback safety) — apuntado al backlog.
 *   - Añadir 4 índices nuevos a tasks:
 *       (project_id, board_column_id, "order")
 *       assignee_id      (partial WHERE assignee_id IS NOT NULL)
 *       phase_id         (partial WHERE phase_id IS NOT NULL)
 *       milestone_id     (partial WHERE milestone_id IS NOT NULL)
 *   - Añadir FK física tasks.board_column_id → board_columns(id) ON DELETE
 *     SET NULL. Si hay filas huérfanas, se loguea warning y se salta la FK
 *     (no aborta la migración).
 *
 * Estrategia:
 *   - Solo aplica a tenants con módulo `projects` habilitado en
 *     master.tenant_modules (hoy: demo, aumenta).
 *   - Todo en una transacción global. Idempotente.
 *
 * Uso:
 *   npm run db:migrate:projects-2         (local)
 *   npm run db:migrate:projects-2:prod    (producción)
 */

import { Sequelize } from "sequelize";
import { acotarSlugs } from "./_solo-este-tenant.js";

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

async function indexExists(s, t, schema, indexName) {
  const [rows] = await s.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`,
    { bind: [schema, indexName], transaction: t }
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

// ─── Pasos individuales ────────────────────────────────────────────────────

async function createTaskAssigneesTable(s, t, schema, result) {
  if (await tableExists(s, t, schema, "task_assignees")) {
    log(`· ${schema}.task_assignees: ya existe`);
    result.taskAssignees = "ya existía";
    return;
  }
  await s.query(`
    CREATE TABLE "${schema}"."task_assignees" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id UUID NOT NULL REFERENCES "${schema}"."tasks"(id) ON DELETE CASCADE,
      team_member_id UUID NOT NULL,
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT task_assignees_unique UNIQUE (task_id, team_member_id)
    )
  `, { transaction: t });
  await s.query(
    `CREATE INDEX "task_assignees_team_member_idx" ON "${schema}"."task_assignees"(team_member_id)`,
    { transaction: t }
  );
  log(`✓ ${schema}.task_assignees: tabla creada (+ UNIQUE + idx team_member)`);
  result.taskAssignees = "creada";
}

async function backfillAssignees(s, t, schema, result) {
  // Migra tasks.assignee_id legacy 1-a-1 → filas task_assignees N-a-N.
  // Idempotente: ON CONFLICT DO NOTHING en (task_id, team_member_id).
  // NO confiar en los DEFAULT de la tabla. El CREATE TABLE de más arriba los
  // define, pero en un schema donde `task_assignees` la creó Sequelize (db:sync)
  // en vez de esta migración, las columnas son NOT NULL *sin* DEFAULT: Sequelize
  // genera id y timestamps en JS, no en Postgres. Un INSERT ... SELECT que se
  // apoye en los defaults revienta ahí con "el valor nulo en la columna ... viola
  // la restricción de no nulo". Se rellenan todas explícitamente.
  const [rows] = await s.query(`
    INSERT INTO "${schema}"."task_assignees"
      (id, task_id, team_member_id, assigned_at, created_at, updated_at)
    SELECT gen_random_uuid(), id, assignee_id, now(), now(), now()
      FROM "${schema}"."tasks"
     WHERE assignee_id IS NOT NULL
    ON CONFLICT (task_id, team_member_id) DO NOTHING
    RETURNING id
  `, { transaction: t });
  log(`✓ ${schema}: migradas ${rows.length} filas legacy tasks.assignee_id → task_assignees`);
  result.backfill = `${rows.length} filas`;
}

async function ensureTasksIndexes(s, t, schema, result) {
  const indexes = [
    {
      name: "tasks_project_column_order_idx",
      ddl: `CREATE INDEX "tasks_project_column_order_idx" ON "${schema}"."tasks"(project_id, board_column_id, "order")`,
    },
    {
      name: "tasks_assignee_idx",
      ddl: `CREATE INDEX "tasks_assignee_idx" ON "${schema}"."tasks"(assignee_id) WHERE assignee_id IS NOT NULL`,
    },
    {
      name: "tasks_phase_idx",
      ddl: `CREATE INDEX "tasks_phase_idx" ON "${schema}"."tasks"(phase_id) WHERE phase_id IS NOT NULL`,
    },
    {
      name: "tasks_milestone_idx",
      ddl: `CREATE INDEX "tasks_milestone_idx" ON "${schema}"."tasks"(milestone_id) WHERE milestone_id IS NOT NULL`,
    },
  ];

  for (const idx of indexes) {
    if (await indexExists(s, t, schema, idx.name)) {
      log(`· ${schema} index ${idx.name}: ya existe`);
      result[idx.name] = "ya existía";
    } else {
      await s.query(idx.ddl, { transaction: t });
      log(`✓ ${schema} index ${idx.name}: creado`);
      result[idx.name] = "creado";
    }
  }
}

async function ensureBoardColumnFk(s, t, schema, result) {
  const constraintName = "tasks_board_column_fk";
  if (await constraintExists(s, t, schema, "tasks", constraintName)) {
    log(`· ${schema}.tasks ${constraintName}: ya existe`);
    result.fk = "ya existía";
    return;
  }

  // Comprobar huérfanos. Si los hay, log warning y SALTAR la FK (no abortar).
  const [orphans] = await s.query(`
    SELECT COUNT(*) AS n
    FROM "${schema}"."tasks" t
    LEFT JOIN "${schema}"."board_columns" bc ON bc.id = t.board_column_id
    WHERE t.board_column_id IS NOT NULL AND bc.id IS NULL
  `, { transaction: t });
  const orphanCount = Number(orphans[0]?.n ?? 0);

  if (orphanCount > 0) {
    log(`⚠ ${schema}.tasks: ${orphanCount} tareas con board_column_id huérfano — SALTA FK (revisar manual)`);
    result.fk = `SALTADA (${orphanCount} huérfanas)`;
    return;
  }

  await s.query(`
    ALTER TABLE "${schema}"."tasks"
    ADD CONSTRAINT "${constraintName}"
    FOREIGN KEY (board_column_id) REFERENCES "${schema}"."board_columns"(id) ON DELETE SET NULL
  `, { transaction: t });
  log(`✓ ${schema}.tasks ${constraintName}: creada`);
  result.fk = "creada";
}

async function processSchemaInTx(s, t, schema) {
  const result = {
    tenant: schema.replace(/^crm_/, ""),
    taskAssignees: "—",
    backfill: "—",
    tasks_project_column_order_idx: "—",
    tasks_assignee_idx: "—",
    tasks_phase_idx: "—",
    tasks_milestone_idx: "—",
    fk: "—",
  };

  // Sanity check: tabla tasks debe existir
  if (!(await tableExists(s, t, schema, "tasks"))) {
    log(`⚠ ${schema}.tasks: tabla no existe — schema no migrado a Sprint 1. SALTA.`);
    result.taskAssignees = "ABORTADO (no tasks)";
    return result;
  }
  if (!(await tableExists(s, t, schema, "board_columns"))) {
    log(`⚠ ${schema}.board_columns: tabla no existe — schema no migrado a Sprint 1. SALTA.`);
    result.taskAssignees = "ABORTADO (no board_columns)";
    return result;
  }

  await createTaskAssigneesTable(s, t, schema, result);
  await backfillAssignees(s, t, schema, result);
  await ensureTasksIndexes(s, t, schema, result);
  await ensureBoardColumnFk(s, t, schema, result);

  return result;
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function fetchProjectTenantSlugs(s) {
  // Tenants con módulo `projects` activo. La lista difiere entre local y
  // producción; siempre se lee en runtime, nunca se hardcodea.
  const [rows] = await s.query(`
    SELECT t.slug
    FROM master.tenants t
    JOIN master.tenant_modules tm ON tm.tenant_id = t.id
    WHERE tm.module_key = 'projects'
      AND tm.enabled = TRUE
    ORDER BY t.slug
  `);
  // Acotado si viene de `ensure-tenant-schema.js` (ONLY_SCHEMAS); global si se
  // lanza a mano, que es como se escribió. Ver scripts/_solo-este-tenant.js.
  return acotarSlugs(rows.map((r) => r.slug));
}

function printSummary(results) {
  process.stdout.write("\n┌──────────────────────────────────────────────────────────────────────────────────────────────┐\n");
  process.stdout.write("│ Resumen migración Proyectos Sprint 2                                                         │\n");
  process.stdout.write("├──────────────┬──────────────┬──────────────┬──────────┬──────────┬──────────┬──────────┬──────┤\n");
  process.stdout.write("│ tenant       │ task_assign. │ backfill     │ idx 1    │ idx 2    │ idx 3    │ idx 4    │ FK   │\n");
  process.stdout.write("├──────────────┼──────────────┼──────────────┼──────────┼──────────┼──────────┼──────────┼──────┤\n");
  for (const r of results) {
    const row = [
      r.tenant.padEnd(12),
      String(r.taskAssignees).padEnd(12),
      String(r.backfill).padEnd(12),
      (r.tasks_project_column_order_idx === "creado" ? "✓ nuevo" : "· prev").padEnd(8),
      (r.tasks_assignee_idx === "creado" ? "✓ nuevo" : "· prev").padEnd(8),
      (r.tasks_phase_idx === "creado" ? "✓ nuevo" : "· prev").padEnd(8),
      (r.tasks_milestone_idx === "creado" ? "✓ nuevo" : "· prev").padEnd(8),
      String(r.fk).padEnd(4),
    ];
    process.stdout.write(`│ ${row.join(" │ ")} │\n`);
  }
  process.stdout.write("└──────────────┴──────────────┴──────────────┴──────────┴──────────┴──────────┴──────────┴──────┘\n");
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: Proyectos Sprint 2 (Kanban)              \n");
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

    header("Obteniendo tenants con módulo projects activo...");
    const slugs = await fetchProjectTenantSlugs(sequelize);
    if (slugs.length === 0) {
      log("· No hay tenants con módulo `projects` habilitado. Nada que hacer.");
      await sequelize.close();
      process.exit(0);
    }
    log(`✓ ${slugs.length} tenants: ${slugs.join(", ")}`);

    header("Aplicando migración (transacción global)...");
    const results = [];
    await sequelize.transaction(async (t) => {
      for (const slug of slugs) {
        const schema = `crm_${slug}`;
        process.stdout.write(`\n· Schema ${schema}\n`);
        const r = await processSchemaInTx(sequelize, t, schema);
        results.push(r);
      }
    });

    printSummary(results);

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
