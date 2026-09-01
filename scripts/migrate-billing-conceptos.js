/**
 * migrate-billing-conceptos.js — el catálogo de conceptos y cuotas de
 * facturación (31/08/2026).
 *
 * Tabla nueva `billing_concepts` por tenant: conceptos habituales con su
 * texto de factura, importe, IVA, categoría y periodicidad, para que una
 * línea de factura se rellene eligiendo en vez de tecleando (lo que Aumenta
 * tenía en el Organízate como «cuotas»).
 *
 * Recorre los schemas con `_schema-targets.js` (`byTable` sobre `invoices`:
 * el catálogo acompaña a quien factura), fotos doradas incluidas. Aditiva e
 * idempotente (CREATE TABLE IF NOT EXISTS), no escribe filas. Correr ANTES
 * de deploy.sh (el modelo nuevo se registra en tenantDb).
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-billing-conceptos.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-billing-conceptos.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: catálogo de conceptos de facturación\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const { schemas, skipped } = await byTable(s, "invoices");
  for (const schema of skipped) {
    process.stdout.write(`  · ${schema}: sin invoices (módulo billing no migrado) — se omite\n`);
  }
  for (const schema of schemas) {
    await s.query(
      `CREATE TABLE IF NOT EXISTS "${schema}"."billing_concepts" (
         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         name VARCHAR(120) NOT NULL,
         description TEXT,
         unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
         vat_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
         category VARCHAR(80),
         periodicity VARCHAR(20),
         active BOOLEAN NOT NULL DEFAULT true,
         sort_order INTEGER NOT NULL DEFAULT 0,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`
    );
    process.stdout.write(`  ✓ ${schema}: billing_concepts lista\n`);
  }

  await s.close();
  process.stdout.write("\n✓ Hecho\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
