/**
 * migrate-clients-fiscal-split.js — el reparto por defecto de las facturas
 * entre los tutores de una familia (06/09/2026, Rodrigo: «padres juntos pero
 * cada uno con su factura»).
 *
 * Columna `clients.fiscal_split` (JSONB, opcional): [{ guardianId, pct }] que
 * suma 100. Con reparto, «Facturar el mes» emite una factura por tutor con su
 * parte y parte los cobros igual; sin reparto manda `fiscal_guardian_id`
 * (04/09/2026) o la ficha. Reglas en `lib/billing/razonSocial.js`.
 *
 * Recorre los schemas con `_schema-targets.js` (`byTable` sobre `clients`),
 * fotos doradas incluidas. Idempotente (IF NOT EXISTS), no escribe filas.
 * Correr ANTES de deploy.sh: el modelo pide la columna por nombre.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-clients-fiscal-split.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-clients-fiscal-split.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function processSchema(s, schema) {
  await s.query(`ALTER TABLE "${schema}"."clients" ADD COLUMN IF NOT EXISTS fiscal_split JSONB`);
  const [col] = await s.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = :schema AND table_name = 'clients' AND column_name = 'fiscal_split'`,
    { replacements: { schema } }
  );
  if (!col.length) throw new Error(`${schema}: la columna fiscal_split NO está`);
  log(`✓ ${schema}: columna fiscal_split asegurada`);
}

async function main() {
  process.stdout.write("\n▶ Migración: el reparto de las facturas entre tutores (clients.fiscal_split)\n");
  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  const { schemas, skipped } = await byTable(s, "clients");
  for (const schema of skipped) log(`· ${schema}: sin clients — se omite`);
  for (const schema of schemas) await processSchema(s, schema);
  await s.close();
  process.stdout.write("\n✓ Hecho\n");
}

main().catch((e) => {
  process.stderr.write(`\n✗ ${e.message}\n`);
  process.exit(1);
});
