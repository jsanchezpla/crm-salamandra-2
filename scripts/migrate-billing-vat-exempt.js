/**
 * migrate-billing-vat-exempt.js — exención general de IVA por tenant.
 *
 * Añade a `tenant_billing_settings`:
 *   - vat_exempt BOOLEAN NOT NULL DEFAULT false → si el emisor NO repercute IVA.
 *   - vat_exempt_note TEXT (nota legal por defecto art. 20 LIVA) → se congela en
 *     cada factura creada mientras la exención esté activa, y el PDF la muestra.
 *
 * Para CADA tenant con tabla `tenant_billing_settings` (master.tenants en runtime,
 * regla #12). Idempotente (ADD COLUMN IF NOT EXISTS), solo añade columnas de
 * config; NO toca facturas existentes. Correr ANTES de deploy.sh en el VPS (el
 * modelo nuevo SELECT-a estas columnas).
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-billing-vat-exempt.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-billing-vat-exempt.js
 */

import { Sequelize } from "sequelize";

const DEFAULT_NOTE = "Operación exenta de IVA conforme al artículo 20 de la Ley 37/1992 del IVA.";

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
  const [rows] = await s.query(`SELECT DISTINCT slug FROM master.tenants WHERE status = 'active' ORDER BY slug`);
  return rows.map((x) => x.slug);
}

async function processSchema(s, schema) {
  if (!(await tableExists(s, schema, "tenant_billing_settings"))) {
    log(`· ${schema}: sin tenant_billing_settings — se omite`);
    return;
  }
  await s.transaction(async (t) => {
    await s.query(
      `ALTER TABLE "${schema}"."tenant_billing_settings"
       ADD COLUMN IF NOT EXISTS vat_exempt BOOLEAN NOT NULL DEFAULT false`,
      { transaction: t }
    );
    const noteSql = DEFAULT_NOTE.replace(/'/g, "''");
    await s.query(
      `ALTER TABLE "${schema}"."tenant_billing_settings"
       ADD COLUMN IF NOT EXISTS vat_exempt_note TEXT DEFAULT '${noteSql}'`,
      { transaction: t }
    );
    log(`✓ ${schema}: vat_exempt + vat_exempt_note listos`);
  });
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: exención general de IVA\n");
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
    try {
      await processSchema(s, schema);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n✓ Migración completada\n\n");
  await s.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
