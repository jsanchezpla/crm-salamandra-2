/**
 * migrate-billing-irpf-partners.js
 *
 * Añade al módulo de facturación:
 *   - invoices.irpf_rate / irpf_amount  (retención IRPF sobre base)
 *   - invoices.partner_id               (socio que gana la factura)
 *   - costs.partner_id                  (socio que se desgrava el gasto)
 *   - tenant_billing_settings.default_irpf_rate (15 por defecto)
 *   - tenant_billing_settings.partners  (Jorge / Rodrigo por defecto)
 *
 * Filtrada por tenants con `billing` activo, idempotente (ADD COLUMN IF NOT
 * EXISTS), por schema independiente. Nombres snake_case = los que generaría
 * sequelize.sync() para tenants nuevos.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-billing-irpf-partners.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-billing-irpf-partners.js
 */

import { Sequelize } from "sequelize";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

const DEFAULT_PARTNERS = JSON.stringify([
  { id: "jorge", name: "Jorge" },
  { id: "rodrigo", name: "Rodrigo" },
]);

async function processSchema(s, schema) {
  await s.query(`
    ALTER TABLE "${schema}"."invoices"
      ADD COLUMN IF NOT EXISTS irpf_rate   NUMERIC(5,2)  NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS irpf_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS partner_id  VARCHAR(255)
  `);
  await s.query(`
    ALTER TABLE "${schema}"."costs"
      ADD COLUMN IF NOT EXISTS partner_id VARCHAR(255)
  `);
  await s.query(`
    ALTER TABLE "${schema}"."tenant_billing_settings"
      ADD COLUMN IF NOT EXISTS default_irpf_rate NUMERIC(5,2) NOT NULL DEFAULT 15,
      ADD COLUMN IF NOT EXISTS partners JSONB NOT NULL DEFAULT '${DEFAULT_PARTNERS}'::jsonb
  `);
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
  process.stdout.write(" Migración: IRPF + atribución por socio (Facturación)\n");
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
      log(`✓ ${schema}: columnas IRPF/partner listas`);
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
