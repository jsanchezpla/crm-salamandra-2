/**
 * migrate-billing-sello.js — el sello del centro en el PDF de factura
 * (31/08/2026).
 *
 * Una columna en `tenant_billing_settings`:
 *   - stamp_url VARCHAR(255) → la imagen del sello (PNG/JPG por https).
 * El PDF lo pinta junto a los totales cuando está configurado, y en la
 * descarga se puede quitar (?sello=0), igual que el nombre del paciente.
 *
 * Recorre los schemas con `_schema-targets.js` (`byTable`): TODOS los que
 * tengan la tabla, fotos doradas incluidas. Idempotente, sin defaults, no
 * escribe filas. Correr ANTES de deploy.sh (el modelo pide la columna).
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-billing-sello.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-billing-sello.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: sello del centro en el PDF\n");
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
         ADD COLUMN IF NOT EXISTS stamp_url VARCHAR(255)`
    );
    process.stdout.write(`  ✓ ${schema}: stamp_url lista\n`);
  }

  await s.close();
  process.stdout.write("\n✓ Hecho\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
