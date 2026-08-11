/**
 * migrate-billing-tax-regime.js — régimen fiscal del emisor + IRPF por defecto a 0.
 *
 * CONTEXTO: `tenant_billing_settings.default_irpf_rate` tenía por defecto 15, así
 * que TODAS las facturas restaban un 15% de IRPF aunque el emisor fuera una SL o
 * facturara a particulares (B2C). Se corrige: el IRPF por defecto pasa a 0 y solo
 * se aplica si el emisor se marca como autónomo profesional (nuevo `tax_regime`).
 *
 * Para CADA tenant con tabla `tenant_billing_settings` (lista de master.tenants en
 * runtime — regla #12), idempotente y NO destructivo con importes ya emitidos
 * (solo toca los DEFAULTS de config, no facturas existentes):
 *   - ADD COLUMN tax_regime VARCHAR(20) NOT NULL DEFAULT 'company' (si no existe).
 *   - tax_regime = 'freelance' donde ya había un IRPF puesto a mano distinto de 15
 *     (alguien lo configuró aposta → era autónomo): se conserva su tipo.
 *   - default_irpf_rate = 0 donde valía 15 (el default heredado no deseado);
 *     ese tenant queda como 'company'. Si de verdad es autónomo, lo re-marca en
 *     Configuración → Facturación con un clic.
 *
 * Solo config; NO recalcula ni toca facturas ya creadas. Re-ejecutable sin efecto.
 * FORWARD-COMPATIBLE con precaución: el modelo nuevo SELECT-a tax_regime, así que
 * en el VPS conviene correrla ANTES de deploy.sh (como las demás columnas nuevas).
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-billing-tax-regime.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-billing-tax-regime.js
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
  const [rows] = await s.query(`SELECT DISTINCT slug FROM master.tenants WHERE status = 'active' ORDER BY slug`);
  // Acotado si viene de `ensure-tenant-schema.js` (ONLY_SCHEMAS); global si se
  // lanza a mano, que es como se escribió. Ver scripts/_solo-este-tenant.js.
  return acotarSlugs(rows.map((x) => x.slug));
}

async function processSchema(s, schema) {
  if (!(await tableExists(s, schema, "tenant_billing_settings"))) {
    log(`· ${schema}: sin tenant_billing_settings — se omite`);
    return;
  }
  await s.transaction(async (t) => {
    await s.query(
      `ALTER TABLE "${schema}"."tenant_billing_settings"
       ADD COLUMN IF NOT EXISTS tax_regime VARCHAR(20) NOT NULL DEFAULT 'company'`,
      { transaction: t }
    );
    // Quien tenía un IRPF puesto a mano distinto de 15 (y > 0) era autónomo aposta:
    // se conserva marcándolo como 'freelance'.
    const [, fr] = await s.query(
      `UPDATE "${schema}"."tenant_billing_settings"
       SET tax_regime = 'freelance'
       WHERE default_irpf_rate > 0 AND default_irpf_rate <> 15`,
      { transaction: t }
    );
    // El 15 heredado (default no deseado) → 0, régimen 'company'.
    const [, rst] = await s.query(
      `UPDATE "${schema}"."tenant_billing_settings"
       SET default_irpf_rate = 0
       WHERE default_irpf_rate = 15`,
      { transaction: t }
    );
    log(`✓ ${schema}: tax_regime listo (${fr?.rowCount ?? 0} como autónomo por IRPF a mano; ${rst?.rowCount ?? 0} reseteados 15→0)`);
  });
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: régimen fiscal + IRPF por defecto a 0\n");
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
