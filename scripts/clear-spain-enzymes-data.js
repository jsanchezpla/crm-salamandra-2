/**
 * clear-spain-enzymes-data.js
 *
 * Vacía TODAS las tablas de datos del schema `crm_spain_enzymes`.
 * Pensado para limpiar los datos demo iniciales en producción cuando
 * Jorge quiere empezar el CRM real de Spain Enzymes desde cero.
 *
 * NO toca:
 *  - El schema en sí (se mantiene).
 *  - Las estructuras de tablas, enums, índices.
 *  - `master.tenants`, `master.users`, `master.tenant_modules` del tenant.
 *  - Configuración fiscal en `master.tenant_billing_settings`.
 *
 * SÍ vacía (TRUNCATE CASCADE):
 *  - Todas las tablas de datos dentro de `crm_spain_enzymes`: leads,
 *    clients, contacts, interactions, invoices, payments, costs,
 *    rates, recurring_invoices, team_members, assets, tasks, projects,
 *    inventory completo (inbound/outbound/batches/formulas/movements),
 *    course/training* si las hubiera.
 *
 * **OBLIGATORIO --confirm**: sin el flag corre en modo dry-run, solo lista
 * las tablas y los recuentos. Con `--confirm` ejecuta el TRUNCATE.
 *
 * Uso:
 *   # Dry-run (ver qué borraría):
 *   docker compose exec app node scripts/clear-spain-enzymes-data.js
 *
 *   # Borrado real (cuidado):
 *   docker compose exec app node scripts/clear-spain-enzymes-data.js --confirm
 */

import { Sequelize } from "sequelize";

const SCHEMA = "crm_spain_enzymes";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function listTables(db, schema) {
  const [rows] = await db.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename`,
    { bind: [schema] }
  );
  return rows.map((r) => r.tablename);
}

async function countRows(db, schema, table) {
  const [rows] = await db.query(`SELECT COUNT(*)::int AS n FROM "${schema}"."${table}"`);
  return rows[0].n;
}

async function main() {
  const confirm = process.argv.includes("--confirm");

  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" Spain Enzymes — Limpiar datos          \n");
  process.stdout.write(`  Schema: ${SCHEMA}                     \n`);
  process.stdout.write(`  Modo:   ${confirm ? "BORRADO REAL" : "DRY-RUN"}\n`);
  process.stdout.write("════════════════════════════════════════\n");

  const db = new Sequelize(process.env.DATABASE_URL, {
    dialect: "postgres",
    logging: false,
  });

  // Verificar que el schema existe
  const [schemaCheck] = await db.query(
    `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
    { bind: [SCHEMA] }
  );
  if (schemaCheck.length === 0) {
    process.stderr.write(`\n✗ Schema "${SCHEMA}" no existe en esta base de datos.\n`);
    process.exit(1);
  }

  header("Tablas detectadas y filas:");
  const tables = await listTables(db, SCHEMA);
  if (tables.length === 0) {
    log("(ninguna tabla en este schema)");
    await db.close();
    process.exit(0);
  }

  let totalRows = 0;
  for (const t of tables) {
    const n = await countRows(db, SCHEMA, t);
    totalRows += n;
    log(`${t.padEnd(38)}  ${String(n).padStart(8)} filas`);
  }
  process.stdout.write(`\n  Total: ${totalRows} filas en ${tables.length} tablas\n`);

  if (!confirm) {
    process.stdout.write("\n════════════════════════════════════════\n");
    process.stdout.write(" DRY-RUN: no se ha borrado nada.\n");
    process.stdout.write(" Para borrar de verdad, ejecuta con --confirm:\n");
    process.stdout.write("   node scripts/clear-spain-enzymes-data.js --confirm\n");
    process.stdout.write("════════════════════════════════════════\n\n");
    await db.close();
    process.exit(0);
  }

  if (totalRows === 0) {
    log("(no hay nada que borrar — todas las tablas ya están vacías)");
    await db.close();
    process.exit(0);
  }

  header("Ejecutando TRUNCATE CASCADE...");
  // TRUNCATE con CASCADE + RESTART IDENTITY de todas las tablas a la vez.
  // CASCADE absorbe las FKs entre tablas del schema sin problema.
  const tableList = tables.map((t) => `"${SCHEMA}"."${t}"`).join(", ");
  await db.query(`TRUNCATE ${tableList} RESTART IDENTITY CASCADE`);
  log(`✓ ${tables.length} tablas vaciadas`);

  header("Verificación:");
  let remaining = 0;
  for (const t of tables) {
    const n = await countRows(db, SCHEMA, t);
    remaining += n;
  }
  if (remaining === 0) {
    log("✓ Todas las tablas están vacías");
  } else {
    log(`✗ Quedan ${remaining} filas — algo no se borró`);
  }

  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" Limpieza completada.\n");
  process.stdout.write("════════════════════════════════════════\n\n");

  await db.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
