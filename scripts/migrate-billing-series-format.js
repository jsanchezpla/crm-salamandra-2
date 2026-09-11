/**
 * migrate-billing-series-format.js
 *
 * El formato con el que escribe cada serie de facturación (12/09/2026):
 *   - invoice_series.number_format (VARCHAR(40), nullable) — fichas
 *     `{prefix}`, `{year}`, `{yy}` y `{n}`/`{n:5}`; ver
 *     lib/billing/formatoDeSerie.js. NULL = `{prefix}-{year}-{n:4}`, el formato
 *     de siempre, así que la migración no cambia cómo numera nadie.
 *
 * Nace para que Aumenta siga en el CRM la numeración de Organízate
 * (`C2602246`, rectificativas `R-C2600029`) en vez de abrir otra serie: sus
 * tres primeras facturas salieron F-2026-0001..0003 y las anularon porque «no
 * puede haber numeraciones distintas». El formato de esa serie se pone aparte,
 * por SQL o por PATCH /api/billing/series/[id]; aquí solo va la columna.
 *
 * Selecciona los schemas por EXISTENCIA de la tabla `invoice_series`, no por
 * módulo (ver scripts/_schema-targets.js). Idempotente (ADD COLUMN IF NOT
 * EXISTS), por schema independiente. VA ANTES del despliegue: el modelo pide la
 * columna por nombre en cada emisión.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-billing-series-format.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-billing-series-format.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function processSchema(s, schema) {
  await s.transaction(async (t) => {
    await s.query(
      `ALTER TABLE "${schema}"."invoice_series"
         ADD COLUMN IF NOT EXISTS number_format VARCHAR(40)`,
      { transaction: t }
    );
  });
}

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: formato del número de cada serie (Facturación)\n");
  process.stdout.write("══════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const sequelize = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  header("Schemas con tabla `invoice_series`...");
  const { schemas, skipped } = await byTable(sequelize, "invoice_series");
  if (schemas.length === 0) {
    log("· Ningún schema con tabla invoice_series. Nada que hacer.");
    await sequelize.close();
    process.exit(0);
  }
  log(`✓ ${schemas.length}: ${schemas.join(", ")}`);
  if (skipped.length) log(`· sin tabla invoice_series, se omiten: ${skipped.join(", ")}`);

  for (const schema of schemas) {
    try {
      await processSchema(sequelize, schema);
      log(`✓ ${schema}: columna number_format lista`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" ✓ Migración completada\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  await sequelize.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
