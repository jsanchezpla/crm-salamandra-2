/**
 * migrate-billing-membretes.js — membrete por documento (31/08/2026).
 *
 * Añade a `tenant_billing_settings` el logo y el pie PROPIOS del presupuesto:
 *   - quote_logo_url VARCHAR(255)
 *   - quote_footer_text TEXT
 * Vacíos, el presupuesto viste el membrete de la factura (`logo_url` /
 * `invoice_footer_text`, que ya existían) — la regla vive en
 * lib/billing/membrete.js.
 *
 * Para CADA tenant con tabla `tenant_billing_settings` (master.tenants en
 * runtime, regla #12). Idempotente (ADD COLUMN IF NOT EXISTS), sin defaults
 * que escriban filas; NO toca ningún dato. Correr ANTES de deploy.sh en el VPS
 * (el modelo nuevo SELECT-a estas columnas).
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-billing-membretes.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-billing-membretes.js
 */

import { Sequelize } from "sequelize";
import { acotarSlugs } from "./_solo-este-tenant.js";

function log(m) { process.stdout.write(`  ${m}\n`); }
function header(m) { process.stdout.write(`\n▶ ${m}\n`); }

async function schemaExists(s, schema) {
  const [r] = await s.query(`SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`, { bind: [schema] });
  return r.length > 0;
}
async function tableExists(s, schema, table) {
  const [r] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    { bind: [schema, table] }
  );
  return r.length > 0;
}
async function fetchSlugs(s) {
  const [rows] = await s.query(`SELECT DISTINCT slug FROM master.tenants ORDER BY slug`);
  return acotarSlugs(rows.map((x) => x.slug));
}

async function processSchema(s, schema) {
  if (!(await tableExists(s, schema, "tenant_billing_settings"))) {
    log(`· ${schema}: sin tenant_billing_settings — se omite`);
    return;
  }
  await s.query(
    `ALTER TABLE "${schema}"."tenant_billing_settings"
       ADD COLUMN IF NOT EXISTS quote_logo_url VARCHAR(255),
       ADD COLUMN IF NOT EXISTS quote_footer_text TEXT`
  );
  log(`✓ ${schema}: quote_logo_url + quote_footer_text listas`);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: membrete por documento (presupuestos)\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const slugs = await fetchSlugs(s);
  log(`✓ ${slugs.length} tenants activos: ${slugs.join(", ")}`);

  for (const slug of slugs) {
    const schema = `crm_${slug}`;
    header(`Tenant ${slug} (${schema})`);
    if (!(await schemaExists(s, schema))) { log(`✗ schema ${schema} no existe, se salta`); continue; }
    await processSchema(s, schema);
  }

  await s.close();
  process.stdout.write("\n✓ Hecho\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
