/**
 * migrate-cobro-de-bono.js — el cobro que sale de un bono sabe de qué bono es
 * (`payments.pack_id`, 08/09/2026, AV-0070 de Aumenta).
 *
 * Desde hoy, dar un bono con importe crea su cobro PENDIENTE, como «Generar el
 * mes» con las cuotas. Esta columna es lo que los ata: sin ella, el cobro sería
 * una fila suelta con el bono nombrado en el texto, y nadie podría saber si un
 * bono ya tiene su deuda apuntada — que es justo lo que hace falta para no
 * duplicarla.
 *
 * NULL = un cobro de los de siempre. Sin FK dura, igual que `cuota_id`: el
 * cobro tiene que sobrevivir a que se anule el bono, porque el dinero que entró
 * no desaparece porque el bono se retire.
 *
 * Solo ESTRUCTURA: una columna a NULL y su índice. Recorre los schemas con
 * `_schema-targets.js` (`byTable` sobre `payments`), fotos doradas incluidas.
 * Idempotente. Correr ANTES de deploy.sh: el modelo la lee.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-cobro-de-bono.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-cobro-de-bono.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function processSchema(s, schema) {
  await s.query(`ALTER TABLE "${schema}"."payments" ADD COLUMN IF NOT EXISTS pack_id UUID`);
  await s.query(`CREATE INDEX IF NOT EXISTS payments_pack_idx ON "${schema}"."payments" (pack_id)`);
  const [col] = await s.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = :schema AND table_name = 'payments' AND column_name = 'pack_id'`,
    { replacements: { schema } }
  );
  if (!col.length) throw new Error(`${schema}: la columna pack_id NO está`);
  log(`✓ ${schema}: columna pack_id asegurada`);
}

async function main() {
  process.stdout.write("\n▶ Migración: el cobro que sale de un bono (payments.pack_id)\n");
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
