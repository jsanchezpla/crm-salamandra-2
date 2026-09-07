/**
 * migrate-billing-cuotas-pagador.js — quién paga la cuota cuando no es la
 * familia (`billing_cuotas.payer_client_id`, 07/09/2026).
 *
 * Tarea del Registro del 06/09/2026: «una fundación o una empresa que paga la
 * cuota de un niño todos los meses hay que facturarla a mano cada mes». La
 * cuota siempre era de la familia (`client_id`) y no había forma de decir «la
 * psicología de Mateo la paga la Fundación Adecco»: cada mes tocaba el Reparto
 * desde la ficha, a mano. Con esta columna el cobro del mes nace a nombre del
 * pagador (con el niño de paciente), «Facturar el mes» le saca su factura y la
 * familia no ve ese importe en la suya. NULL = paga la familia, lo de siempre.
 *
 * Solo ESTRUCTURA: una columna nueva a NULL para todo lo que ya existe y su
 * índice. Recorre los schemas con `_schema-targets.js` (`byTable` sobre
 * `billing_cuotas`), fotos doradas incluidas. Idempotente. Correr ANTES de
 * deploy.sh: el modelo la lee.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-billing-cuotas-pagador.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-billing-cuotas-pagador.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function processSchema(s, schema) {
  await s.query(`ALTER TABLE "${schema}"."billing_cuotas" ADD COLUMN IF NOT EXISTS payer_client_id UUID`);
  await s.query(`CREATE INDEX IF NOT EXISTS billing_cuotas_payer_idx ON "${schema}"."billing_cuotas" (payer_client_id)`);
  const [col] = await s.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = :schema AND table_name = 'billing_cuotas' AND column_name = 'payer_client_id'`,
    { replacements: { schema } }
  );
  if (!col.length) throw new Error(`${schema}: la columna payer_client_id NO está`);
  log(`✓ ${schema}: columna payer_client_id asegurada`);
}

async function main() {
  process.stdout.write("\n▶ Migración: quién paga la cuota cuando no es la familia (billing_cuotas.payer_client_id)\n");
  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  const { schemas, skipped } = await byTable(s, "billing_cuotas");
  for (const schema of skipped) log(`· ${schema}: sin billing_cuotas — se omite`);
  for (const schema of schemas) await processSchema(s, schema);
  await s.close();
  process.stdout.write("\n✓ Hecho\n");
}

main().catch((e) => {
  process.stderr.write(`\n✗ ${e.message}\n`);
  process.exit(1);
});
