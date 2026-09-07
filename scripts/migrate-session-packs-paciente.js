/**
 * migrate-session-packs-paciente.js — de quién es el bono cuando la familia
 * tiene más de un hijo (`session_packs.patient_id`, 08/09/2026).
 *
 * AV-0055 de Aumenta, Olga: «los bonos tendrían que reflejarse por paciente no
 * cliente o estar enlazados». El bono colgaba de la FAMILIA (por correo o por
 * ficha), así que en una familia con dos hermanos el bono de uno se le gastaba
 * al otro sin que nadie lo viera: las citas del hermano equivocado descontaban
 * sesiones del mismo montón.
 *
 * NULL = de la familia entera, que es lo que hay hoy y lo que se sigue
 * ofreciendo a cualquiera de sus pacientes. Con paciente, el bono SOLO se
 * engancha a las citas de ese paciente (`lib/citas/packs.js`).
 *
 * Solo ESTRUCTURA: una columna a NULL para todo lo que ya existe y su índice.
 * Recorre los schemas con `_schema-targets.js` (`byTable` sobre
 * `session_packs`), fotos doradas incluidas. Idempotente. Correr ANTES de
 * deploy.sh: el modelo la lee.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-session-packs-paciente.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-session-packs-paciente.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function processSchema(s, schema) {
  await s.query(`ALTER TABLE "${schema}"."session_packs" ADD COLUMN IF NOT EXISTS patient_id UUID`);
  await s.query(
    `CREATE INDEX IF NOT EXISTS session_packs_patient_idx ON "${schema}"."session_packs" (patient_id)`
  );
  const [col] = await s.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = :schema AND table_name = 'session_packs' AND column_name = 'patient_id'`,
    { replacements: { schema } }
  );
  if (!col.length) throw new Error(`${schema}: la columna patient_id NO está`);
  log(`✓ ${schema}: columna patient_id asegurada`);
}

async function main() {
  process.stdout.write("\n▶ Migración: de quién es el bono (session_packs.patient_id)\n");
  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  const { schemas, skipped } = await byTable(s, "session_packs");
  for (const schema of skipped) log(`· ${schema}: sin session_packs — se omite`);
  for (const schema of schemas) await processSchema(s, schema);
  await s.close();
  process.stdout.write("\n✓ Hecho\n");
}

main().catch((e) => {
  process.stderr.write(`\n✗ ${e.message}\n`);
  process.exit(1);
});
