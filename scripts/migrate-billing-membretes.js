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
 * Recorre los schemas con `_schema-targets.js` (`byTable`): TODOS los que
 * tengan la tabla, fotos doradas de las demos incluidas — la primera versión
 * de este script (misma mañana) leía master.tenants a mano y se las saltó, y
 * el aviso de deploy.sh lo cantó. Idempotente (ADD COLUMN IF NOT EXISTS), sin
 * defaults que escriban filas; NO toca ningún dato. Correr ANTES de deploy.sh
 * (el modelo pide las columnas por nombre).
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-billing-membretes.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-billing-membretes.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: membrete por documento (presupuestos)\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const { schemas, skipped } = await byTable(s, "tenant_billing_settings");
  for (const schema of skipped) {
    process.stdout.write(`  · ${schema}: sin tenant_billing_settings — se omite\n`);
  }
  for (const schema of schemas) {
    await s.query(
      `ALTER TABLE "${schema}"."tenant_billing_settings"
         ADD COLUMN IF NOT EXISTS quote_logo_url VARCHAR(255),
         ADD COLUMN IF NOT EXISTS quote_footer_text TEXT`
    );
    process.stdout.write(`  ✓ ${schema}: quote_logo_url + quote_footer_text listas\n`);
  }

  await s.close();
  process.stdout.write("\n✓ Hecho\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
