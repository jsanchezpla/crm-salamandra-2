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
 * Filtrada por tenants con `billing` activo, idempotente (ADD COLUMN IF NOT
 * EXISTS), por schema independiente. Nombre snake_case = el que generaría
 * sequelize.sync() (underscored) para tenants nuevos.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-billing-correction-reason.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-billing-correction-reason.js
 */

import { Sequelize } from "sequelize";

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

async function fetchBillingSlugs(s) {
  const [rows] = await s.query(`
    SELECT t.slug FROM master.tenants t
    JOIN master.tenant_modules tm ON tm.tenant_id = t.id
    WHERE t.status = 'active' AND tm.module_key = 'billing' AND tm.enabled = TRUE
    ORDER BY t.slug
  `);
  return rows.map((r) => r.slug);
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

  header("Tenants con módulo billing activo...");
  const slugs = await fetchBillingSlugs(sequelize);
  if (slugs.length === 0) {
    log("· Ninguno. Nada que hacer.");
    await sequelize.close();
    process.exit(0);
  }
  log(`✓ ${slugs.length} tenants: ${slugs.join(", ")}`);

  for (const slug of slugs) {
    const schema = `crm_${slug}`;
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
