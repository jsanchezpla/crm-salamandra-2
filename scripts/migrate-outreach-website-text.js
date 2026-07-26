/**
 * migrate-outreach-website-text.js
 *
 * Amplía `outreach_leads.website` de VARCHAR(255) a TEXT. El `websiteUri` de
 * Google (y algún "sitio web" de GMB que en realidad es una URL de reservas con
 * parámetros) supera los 255 caracteres y hacía fallar el INSERT de "Buscar
 * nuevos" con «value too long for type character varying(255)».
 *
 * - Lee los tenants con `outreach` activo desde master en runtime (regla #12).
 * - Idempotente: si la columna ya es TEXT no hace nada. Salta el schema si aún
 *   no existe la tabla outreach_leads.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-outreach-website-text.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-outreach-website-text.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function tableExists(s, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    { bind: [schema, table] }
  );
  return rows.length > 0;
}

async function columnType(s, schema, table, column) {
  const [rows] = await s.query(
    `SELECT data_type FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
    { bind: [schema, table, column] }
  );
  return rows[0]?.data_type ?? null;
}

// Selección por EXISTENCIA de tabla, no por módulo: ver scripts/_schema-targets.js
// y el incidente del 2026-07-21 (bug de las reservas de tunutrilaura.com).

async function processSchema(s, schema) {
  if (!(await tableExists(s, schema, "outreach_leads"))) return { skipped: true };
  const type = await columnType(s, schema, "outreach_leads", "website");
  if (type === "text") return { already: true };
  // ALTER ... TYPE TEXT es seguro (VARCHAR → TEXT no pierde datos ni requiere USING).
  await s.query(`ALTER TABLE "${schema}"."outreach_leads" ALTER COLUMN "website" TYPE TEXT`);
  return { changed: true };
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: Outreach — website VARCHAR(255) → TEXT \n");
  process.stdout.write("════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  const sequelize = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const { schemas, skipped } = await byTable(sequelize, "outreach_leads");
  if (schemas.length === 0) {
    log("· Ningún schema con tabla outreach_leads.");
    await sequelize.close();
    process.exit(0);
  }
  log(`✓ ${schemas.length}: ${schemas.join(", ")}`);
  if (skipped.length) log(`· sin tabla outreach_leads, se omiten: ${skipped.join(", ")}`);

  for (const schema of schemas) {
    try {
      const r = await processSchema(sequelize, schema);
      if (r.skipped) log(`· ${schema}: sin outreach_leads (se salta)`);
      else if (r.already) log(`· ${schema}: website ya es TEXT`);
      else log(`· ${schema}: website → TEXT ✓`);
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
