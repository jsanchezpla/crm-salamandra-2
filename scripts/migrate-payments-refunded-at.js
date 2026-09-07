/**
 * migrate-payments-refunded-at.js — cuándo se devolvió un cobro
 * (`payments.refunded_at`, 07/09/2026).
 *
 * Marcar un cobro como «Devuelto» lo sacaba de lo cobrado pero no apuntaba la
 * salida del dinero en ningún sitio: el arqueo del día de la devolución
 * cuadraba de menos (tarea del Registro del 06/09/2026). Con esta columna el
 * cobro devuelto son dos apuntes —entró el día `paid_at`, salió el día
 * `refunded_at`— y el resumen por día y el esperado del cierre lo restan donde
 * toca. La escribe el PATCH de cobros y la devolución que llega de Stripe.
 *
 * Solo ESTRUCTURA: una columna nueva, NULL para todo lo que ya existe (en
 * producción no hay ningún cobro en `refunded` todavía). Recorre los schemas
 * con `_schema-targets.js` (`byTable` sobre `payments`), fotos doradas
 * incluidas. Idempotente. Correr ANTES de deploy.sh: el modelo la lee.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-payments-refunded-at.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-payments-refunded-at.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function processSchema(s, schema) {
  await s.query(`ALTER TABLE "${schema}"."payments" ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ`);
  const [col] = await s.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = :schema AND table_name = 'payments' AND column_name = 'refunded_at'`,
    { replacements: { schema } }
  );
  if (!col.length) throw new Error(`${schema}: la columna refunded_at NO está`);
  log(`✓ ${schema}: columna refunded_at asegurada`);
}

async function main() {
  process.stdout.write("\n▶ Migración: cuándo se devolvió un cobro (payments.refunded_at)\n");
  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  const { schemas, skipped } = await byTable(s, "payments");
  for (const schema of skipped) log(`· ${schema}: sin payments — se omite`);
  for (const schema of schemas) await processSchema(s, schema);
  await s.close();
  process.stdout.write("\n✓ Hecho\n");
}

main().catch((e) => {
  process.stderr.write(`\n✗ ${e.message}\n`);
  process.exit(1);
});
