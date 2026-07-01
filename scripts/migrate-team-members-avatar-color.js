/**
 * migrate-team-members-avatar-color.js
 *
 * Añade la columna `avatar_color` (VARCHAR(7)) a `team_members` en TODOS los
 * schemas crm_* y aplica un backfill determinista basado en el MD5 del id:
 *   `'#' || SUBSTR(MD5(id::text), 1, 6)`
 *
 * Esto da un color hex estable por miembro (mismo id → mismo color siempre),
 * útil como fondo del avatar circular cuando no hay `avatarUrl`. El frontend
 * (TaskCard, TaskDrawer y otros) ya consume el campo desde Sprint 2 Proyectos.
 *
 * Estrategia:
 *   - Lee la lista de schemas crm_* desde information_schema.schemata
 *     (regla 12 de CLAUDE.md: no hardcodear). El módulo team es genérico,
 *     así que aplica a TODOS los tenants, no solo a los que tengan
 *     `team_modules.module_key='projects'` activo.
 *   - Idempotente:
 *       · `ADD COLUMN IF NOT EXISTS` no falla si ya existe.
 *       · `UPDATE ... WHERE avatar_color IS NULL` solo afecta filas pendientes.
 *   - Una sola transacción global; si algo falla, ROLLBACK.
 *
 * Uso:
 *   npm run db:migrate:avatar-color         (local)
 *   npm run db:migrate:avatar-color:prod    (producción)
 */

import { Sequelize } from "sequelize";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function listSchemas(sequelize) {
  const [rows] = await sequelize.query(`
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name LIKE 'crm_%'
    ORDER BY schema_name
  `);
  return rows.map((r) => r.schema_name);
}

async function processSchemaInTx(sequelize, t, schema) {
  const result = { schema, addedColumn: "—", backfilled: 0, total: 0 };

  // Sanity check: team_members debe existir en este schema
  const [tablesRows] = await sequelize.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'team_members'`,
    { bind: [schema], transaction: t }
  );
  if (tablesRows.length === 0) {
    log(`⚠ ${schema}.team_members: tabla no existe — SALTA`);
    result.addedColumn = "SALTADA (sin tabla)";
    return result;
  }

  // 1) ADD COLUMN IF NOT EXISTS — la BD lo trata como no-op si ya existe.
  //    Comprobamos previamente para mejorar el log.
  const [colsRows] = await sequelize.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = 'team_members' AND column_name = 'avatar_color'`,
    { bind: [schema], transaction: t }
  );
  if (colsRows.length === 0) {
    await sequelize.query(
      `ALTER TABLE "${schema}"."team_members" ADD COLUMN avatar_color VARCHAR(7)`,
      { transaction: t }
    );
    log(`✓ ${schema}.team_members.avatar_color: columna añadida`);
    result.addedColumn = "añadida";
  } else {
    log(`· ${schema}.team_members.avatar_color: ya existe`);
    result.addedColumn = "ya existía";
  }

  // 2) Backfill determinista — solo filas con avatar_color IS NULL.
  const [updRows] = await sequelize.query(
    `UPDATE "${schema}"."team_members"
       SET avatar_color = '#' || SUBSTR(MD5(id::text), 1, 6)
     WHERE avatar_color IS NULL
     RETURNING id`,
    { transaction: t }
  );
  result.backfilled = updRows.length;
  log(`${updRows.length > 0 ? "✓" : "·"} ${schema}: backfill ${updRows.length} filas`);

  // 3) Total de filas (para el resumen).
  const [totRows] = await sequelize.query(
    `SELECT COUNT(*)::int AS n FROM "${schema}"."team_members"`,
    { transaction: t }
  );
  result.total = totRows[0]?.n ?? 0;

  return result;
}

function printSummary(results) {
  process.stdout.write("\n┌───────────────────────────────────────────────────────────────────────┐\n");
  process.stdout.write("│ Resumen migración team_members.avatar_color                           │\n");
  process.stdout.write("├──────────────────────┬─────────────────┬──────────────┬───────────────┤\n");
  process.stdout.write("│ schema               │ columna         │ backfill     │ filas totales │\n");
  process.stdout.write("├──────────────────────┼─────────────────┼──────────────┼───────────────┤\n");
  for (const r of results) {
    const row = [
      r.schema.padEnd(20),
      String(r.addedColumn).padEnd(15),
      String(r.backfilled).padEnd(12),
      String(r.total).padEnd(13),
    ];
    process.stdout.write(`│ ${row.join(" │ ")} │\n`);
  }
  process.stdout.write("└──────────────────────┴─────────────────┴──────────────┴───────────────┘\n");
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: team_members.avatar_color (todos crm_*)     \n");
  process.stdout.write("════════════════════════════════════════════════════════\n");

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

    header("Listando schemas crm_*...");
    const schemas = await listSchemas(sequelize);
    if (schemas.length === 0) {
      log("· No hay schemas crm_*. Nada que hacer.");
      await sequelize.close();
      process.exit(0);
    }
    log(`✓ ${schemas.length} schemas: ${schemas.join(", ")}`);

    header("Aplicando migración (transacción global)...");
    const results = [];
    await sequelize.transaction(async (t) => {
      for (const schema of schemas) {
        process.stdout.write(`\n· Schema ${schema}\n`);
        const r = await processSchemaInTx(sequelize, t, schema);
        results.push(r);
      }
    });

    printSummary(results);

    process.stdout.write("\n════════════════════════════════════════════════════════\n");
    process.stdout.write(" ✓ Migración completada                                 \n");
    process.stdout.write("════════════════════════════════════════════════════════\n\n");

    await sequelize.close();
    process.exit(0);
  } catch (err) {
    await sequelize.close();
    process.stderr.write(`\n✗ Error: ${err.message}\n`);
    if (process.env.NODE_ENV !== "production") {
      process.stderr.write(`${err.stack}\n`);
    }
    process.exit(1);
  }
}

main();
