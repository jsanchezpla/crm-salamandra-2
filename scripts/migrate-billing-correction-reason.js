/**
 * migrate-billing-correction-reason.js
 *
 * Sprint "Rectificativas con edición". Añade a facturación:
 *   - invoices.correction_reason  (VARCHAR) — motivo de la rectificación
 *     (error de importe, error de IVA, error de datos, otros). Solo lo
 *     llevan las facturas de serie R; nullable para el resto.
 *
 * NO añade `original_invoice_id` (ya existe como `rectifies_invoice_id`) ni
 * `is_correction` (derivable de rectifies_invoice_id IS NOT NULL).
 *
 * Selecciona los schemas por EXISTENCIA de la tabla `invoices`, no por módulo:
 * si un tenant ya tiene la tabla, se blinda aunque todavía no haya comprado
 * Facturación (ver scripts/_schema-targets.js). Idempotente (ADD COLUMN IF NOT
 * EXISTS), por schema independiente. Nombre snake_case = el que generaría
 * sequelize.sync() (underscored) para tenants nuevos.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-billing-correction-reason.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-billing-correction-reason.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function processSchema(s, schema) {
  // Transacción por-tenant: el ALTER de cada schema es atómico e independiente.
  await s.transaction(async (t) => {
    await s.query(
      `ALTER TABLE "${schema}"."invoices"
         ADD COLUMN IF NOT EXISTS correction_reason VARCHAR(255)`,
      { transaction: t }
    );
  });
}

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: motivo de rectificación (Facturación)\n");
  process.stdout.write("══════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const sequelize = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  header("Schemas con tabla `invoices`...");
  const { schemas, skipped } = await byTable(sequelize, "invoices");
  if (schemas.length === 0) {
    log("· Ningún schema con tabla invoices. Nada que hacer.");
    await sequelize.close();
    process.exit(0);
  }
  log(`✓ ${schemas.length}: ${schemas.join(", ")}`);
  if (skipped.length) log(`· sin tabla invoices, se omiten: ${skipped.join(", ")}`);

  for (const schema of schemas) {
    try {
      await processSchema(sequelize, schema);
      log(`✓ ${schema}: columna correction_reason lista`);
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
