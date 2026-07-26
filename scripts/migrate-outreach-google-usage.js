/**
 * migrate-outreach-google-usage.js
 *
 * Añade a `outreach_settings` el contador mensual de peticiones a Google Places
 * (tope de 999/mes + aviso por email, gestionados por el CRM, no por Google):
 *
 *   google_places_usage_month   VARCHAR(7)  "YYYY-MM" del contador vigente
 *   google_places_usage_count   INTEGER     peticiones consumidas ese mes
 *   google_places_warned_month  VARCHAR(7)  mes en que ya se avisó por email
 *
 * - Lee los tenants con `outreach` activo desde master.tenant_modules en runtime
 *   (nunca hardcode; difiere local↔prod).
 * - Idempotente: ADD COLUMN IF NOT EXISTS. Salta el schema si aún no tiene la
 *   tabla outreach_settings (sprint-1 no ejecutado ahí).
 * - Por schema independiente: si uno falla, sigue con el resto.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-outreach-google-usage.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-outreach-google-usage.js
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

// Selección por EXISTENCIA de tabla, no por módulo: ver scripts/_schema-targets.js
// y el incidente del 2026-07-21 (bug de las reservas de tunutrilaura.com).

async function processSchema(s, schema) {
  if (!(await tableExists(s, schema, "outreach_settings"))) {
    return { skipped: true };
  }
  await s.query(`
    ALTER TABLE "${schema}"."outreach_settings"
      ADD COLUMN IF NOT EXISTS google_places_usage_month  VARCHAR(7),
      ADD COLUMN IF NOT EXISTS google_places_usage_count  INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS google_places_warned_month VARCHAR(7)
  `);
  return { skipped: false };
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: Outreach — contador de Google Places \n");
  process.stdout.write("════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  const sequelize = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const { schemas, skipped } = await byTable(sequelize, "outreach_settings");
  if (schemas.length === 0) {
    log("· Ningún schema con tabla outreach_settings.");
    await sequelize.close();
    process.exit(0);
  }
  log(`✓ ${schemas.length}: ${schemas.join(", ")}`);
  if (skipped.length) log(`· sin tabla outreach_settings, se omiten: ${skipped.join(", ")}`);

  for (const schema of schemas) {
    try {
      const r = await processSchema(sequelize, schema);
      log(r.skipped ? `· ${schema}: sin outreach_settings (se salta)` : `· ${schema}: columnas OK`);
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
