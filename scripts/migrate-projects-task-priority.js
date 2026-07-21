/**
 * migrate-projects-task-priority.js
 *
 * Añade la columna `priority` (enum low|medium|high|urgent, default 'medium')
 * a la tabla `tasks` del módulo Proyectos, para la Vista de Lista (ordena por
 * prioridad) y el badge del Kanban.
 *
 * Estrategia:
 *   - Solo tenants con módulo `projects` activo en master.tenant_modules
 *     (la lista se lee en runtime — difiere entre local y prod, nunca hardcode).
 *   - Por cada schema: crea el tipo enum si no existe y añade la columna con
 *     ADD COLUMN IF NOT EXISTS. Idempotente. Todo en una transacción global.
 *
 * Uso:
 *   npm run db:migrate:projects-priority        (local)
 *   npm run db:migrate:projects-priority:prod   (producción)
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

const ENUM_TYPE = "enum_tasks_priority";
const ENUM_VALUES = ["low", "medium", "high", "urgent"];

async function tableExists(s, t, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    { bind: [schema, table], transaction: t }
  );
  return rows.length > 0;
}

async function enumTypeExists(s, t, schema, typeName) {
  const [rows] = await s.query(
    `SELECT 1 FROM pg_type ty JOIN pg_namespace n ON n.oid = ty.typnamespace
     WHERE n.nspname = $1 AND ty.typname = $2`,
    { bind: [schema, typeName], transaction: t }
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

async function processSchemaInTx(s, t, schema) {
  const result = { tenant: schema.replace(/^crm_/, ""), enumType: "—", column: "—" };

  if (!(await tableExists(s, t, schema, "tasks"))) {
    log(`⚠ ${schema}.tasks: tabla no existe — schema sin Proyectos. SALTA.`);
    result.column = "ABORTADO (no tasks)";
    return result;
  }

  // 1) Tipo enum (Sequelize lo llama enum_tasks_priority en el schema del modelo).
  if (await enumTypeExists(s, t, schema, ENUM_TYPE)) {
    log(`· ${schema}.${ENUM_TYPE}: ya existe`);
    result.enumType = "ya existía";
  } else {
    const values = ENUM_VALUES.map((v) => `'${v}'`).join(", ");
    await s.query(`CREATE TYPE "${schema}"."${ENUM_TYPE}" AS ENUM (${values})`, { transaction: t });
    log(`✓ ${schema}.${ENUM_TYPE}: creado`);
    result.enumType = "creado";
  }

  // 2) Columna priority NOT NULL DEFAULT 'medium'.
  if (await columnExists(s, t, schema, "tasks", "priority")) {
    log(`· ${schema}.tasks.priority: ya existe`);
    result.column = "ya existía";
  } else {
    await s.query(
      `ALTER TABLE "${schema}"."tasks"
       ADD COLUMN IF NOT EXISTS "priority" "${schema}"."${ENUM_TYPE}" NOT NULL DEFAULT 'medium'`,
      { transaction: t }
    );
    log(`✓ ${schema}.tasks.priority: añadida (default 'medium')`);
    result.column = "añadida";
  }

  return result;
}

// Selección por EXISTENCIA de tabla, no por módulo: ver scripts/_schema-targets.js
// y el incidente del 2026-07-21 (bug de las reservas de tunutrilaura.com).

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: Proyectos — tasks.priority               \n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  const sequelize = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  try {
    const [versionRows] = await sequelize.query("SHOW server_version");
    log(`PostgreSQL: ${versionRows[0]?.server_version ?? "?"}`);

    header("Obteniendo schemas con tabla `tasks`...");
    const { schemas, skipped } = await byTable(sequelize, "tasks");
    if (schemas.length === 0) {
      log("· Ningún schema con tabla `tasks`. Nada que hacer.");
      await sequelize.close();
      process.exit(0);
    }
    log(`✓ ${schemas.length}: ${schemas.join(", ")}`);
    if (skipped.length) log(`· sin tabla tasks, se omiten: ${skipped.join(", ")}`);

    header("Aplicando migración (transacción global)...");
    const results = [];
    await sequelize.transaction(async (t) => {
      for (const schema of schemas) {
        process.stdout.write(`\n· Schema ${schema}\n`);
        results.push(await processSchemaInTx(sequelize, t, schema));
      }
    });

    process.stdout.write("\n┌──────────────┬──────────────┬──────────────┐\n");
    process.stdout.write("│ tenant       │ enum type    │ columna      │\n");
    process.stdout.write("├──────────────┼──────────────┼──────────────┤\n");
    for (const r of results) {
      process.stdout.write(`│ ${r.tenant.padEnd(12)} │ ${String(r.enumType).padEnd(12)} │ ${String(r.column).padEnd(12)} │\n`);
    }
    process.stdout.write("└──────────────┴──────────────┴──────────────┘\n");

    process.stdout.write("\n✓ Migración completada\n\n");
    await sequelize.close();
    process.exit(0);
  } catch (err) {
    await sequelize.close();
    throw err;
  }
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
