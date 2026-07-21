/**
 * migrate-outreach-convert.js
 *
 * Añade a `outreach_leads` los campos de conversión a cliente:
 *   converted    BOOLEAN NOT NULL DEFAULT FALSE
 *   converted_at TIMESTAMPTZ
 *   client_id    UUID              (referencia blanda al Client, sin FK)
 *
 * Un lead convertido se marca (no se borra): desaparece de la lista de captados
 * y "Buscar nuevos" no lo vuelve a insertar.
 *
 * - Lee los tenants con `outreach` activo desde master en runtime (regla #12).
 * - Idempotente (ADD COLUMN IF NOT EXISTS). Salta el schema si no existe aún la
 *   tabla outreach_leads.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-outreach-convert.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-outreach-convert.js
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
  if (!(await tableExists(s, schema, "outreach_leads"))) return { skipped: true };
  await s.query(`
    ALTER TABLE "${schema}"."outreach_leads"
      ADD COLUMN IF NOT EXISTS converted    BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS client_id    UUID
  `);
  return { skipped: false };
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: Outreach — conversión a cliente      \n");
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
      log(r.skipped ? `· ${schema}: sin outreach_leads (se salta)` : `· ${schema}: columnas OK`);
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
