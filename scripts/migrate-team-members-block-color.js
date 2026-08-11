/**
 * migrate-team-members-block-color.js
 *
 * Añade la columna `block_color` (VARCHAR(7)) a `team_members` en TODOS los
 * schemas crm_*: el color con el que se pintan LOS BLOQUEOS de esa persona en
 * la agenda (10/08/2026, Rodrigo).
 *
 * ── Sin backfill, a diferencia de su hermana `avatar_color` ─────────────────
 *
 * Aquella rellenaba un color determinista para todos porque un avatar sin color
 * no se ve. Aquí el NULL es un valor con significado: «hereda el color general
 * del centro» (`settings.citas.colorBloqueos`). Rellenarlo daría a cada persona
 * un color al azar el día del despliegue, y el ajuste general —que es lo que se
 * ha pedido— no volvería a tener efecto sobre nadie.
 *
 * Estrategia:
 *   - Lee los schemas de information_schema (regla 12: no hardcodear slugs).
 *     El módulo team es genérico, así que aplica a TODOS los tenants.
 *   - Idempotente: comprueba la columna antes de añadirla; relanzarlo no hace
 *     nada. No toca ni una fila de datos.
 *   - Una sola transacción global; si algo falla, ROLLBACK.
 *
 * Uso:
 *   npm run db:migrate:block-color         (local)
 *   npm run db:migrate:block-color:prod    (producción)
 */

import { Sequelize } from "sequelize";
import { acotarSchemas } from "./_solo-este-tenant.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function listSchemas(sequelize) {
  const [rows] = await sequelize.query(`
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name LIKE 'crm_%'
    ORDER BY schema_name
  `);
  // Acotado si viene de `ensure-tenant-schema.js` (ONLY_SCHEMAS); global si se
  // lanza a mano, que es como se escribió. Ver scripts/_solo-este-tenant.js.
  return acotarSchemas(rows.map((r) => r.schema_name));
}

async function processSchemaInTx(sequelize, t, schema) {
  const result = { schema, addedColumn: "—", total: 0 };

  const [tablesRows] = await sequelize.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'team_members'`,
    { bind: [schema], transaction: t }
  );
  if (tablesRows.length === 0) {
    log(`⚠ ${schema}.team_members: tabla no existe — SALTA`);
    result.addedColumn = "SALTADA (sin tabla)";
    return result;
  }

  const [colsRows] = await sequelize.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = 'team_members' AND column_name = 'block_color'`,
    { bind: [schema], transaction: t }
  );
  if (colsRows.length === 0) {
    await sequelize.query(
      `ALTER TABLE "${schema}"."team_members" ADD COLUMN block_color VARCHAR(7)`,
      { transaction: t }
    );
    log(`✓ ${schema}.team_members.block_color: columna añadida`);
    result.addedColumn = "añadida";
  } else {
    log(`· ${schema}.team_members.block_color: ya existe`);
    result.addedColumn = "ya existía";
  }

  const [totRows] = await sequelize.query(
    `SELECT COUNT(*)::int AS n FROM "${schema}"."team_members"`,
    { transaction: t }
  );
  result.total = totRows[0]?.n ?? 0;

  return result;
}

function printSummary(results) {
  process.stdout.write("\n┌─────────────────────────────────────────────────────────┐\n");
  process.stdout.write("│ Resumen migración team_members.block_color              │\n");
  process.stdout.write("├──────────────────────┬─────────────────┬────────────────┤\n");
  process.stdout.write("│ schema               │ columna         │ filas totales  │\n");
  process.stdout.write("├──────────────────────┼─────────────────┼────────────────┤\n");
  for (const r of results) {
    const row = [
      r.schema.padEnd(20),
      String(r.addedColumn).padEnd(15),
      String(r.total).padEnd(14),
    ];
    process.stdout.write(`│ ${row.join(" │ ")} │\n`);
  }
  process.stdout.write("└──────────────────────┴─────────────────┴────────────────┘\n");
  process.stdout.write("\n· Todas nacen vacías: cada persona hereda el color general del centro\n");
  process.stdout.write("  hasta que se le ponga uno propio en su ficha de equipo.\n");
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: team_members.block_color (todos crm_*)      \n");
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
