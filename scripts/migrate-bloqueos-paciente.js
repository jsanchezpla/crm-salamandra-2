/**
 * migrate-bloqueos-paciente.js — de quién es un hueco reservado
 * (`team_blocks.patient_id`, 08/09/2026, Rodrigo).
 *
 * El 14/08/2026 los bloqueos dejaron de seguir el filtro de visibilidad de las
 * citas y pasaron a verlos todos, y el motivo que se escribió fue que «un
 * bloqueo no tiene paciente». En Aumenta sí lo tiene: 381 huecos de reserva de
 * plaza llevan el nombre y el apellido de un niño escritos EN EL RÓTULO, que es
 * texto libre y no obedece a ningún permiso.
 *
 * Con esta columna el nombre viaja por el enlace —que sí sabe quién puede
 * verlo— y el rótulo se queda con lo que le sirve a recepción («Reservado,
 * empieza el 15/09»). NULL = un bloqueo de los de siempre, que no es de nadie:
 * vacaciones, gestión documental, una reunión.
 *
 * Solo ESTRUCTURA: una columna a NULL para todo lo que ya existe y su índice.
 * Sin FK dura, igual que `taller_id`: un bloqueo tiene que sobrevivir al
 * borrado de una ficha, y quien lo lee ya tolera que el paciente no esté.
 * Recorre los schemas con `_schema-targets.js` (`byTable` sobre `team_blocks`),
 * fotos doradas incluidas. Idempotente. Correr ANTES de deploy.sh: el modelo la
 * lee.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-bloqueos-paciente.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-bloqueos-paciente.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function processSchema(s, schema) {
  await s.query(`ALTER TABLE "${schema}"."team_blocks" ADD COLUMN IF NOT EXISTS patient_id UUID`);
  await s.query(
    `CREATE INDEX IF NOT EXISTS team_blocks_patient_idx ON "${schema}"."team_blocks" (patient_id)`
  );
  const [col] = await s.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = :schema AND table_name = 'team_blocks' AND column_name = 'patient_id'`,
    { replacements: { schema } }
  );
  if (!col.length) throw new Error(`${schema}: la columna patient_id NO está`);
  log(`✓ ${schema}: columna patient_id asegurada`);
}

async function main() {
  process.stdout.write("\n▶ Migración: de quién es un hueco reservado (team_blocks.patient_id)\n");
  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  const { schemas, skipped } = await byTable(s, "team_blocks");
  for (const schema of skipped) log(`· ${schema}: sin team_blocks — se omite`);
  for (const schema of schemas) await processSchema(s, schema);
  await s.close();
  process.stdout.write("\n✓ Hecho\n");
}

main().catch((e) => {
  process.stderr.write(`\n✗ ${e.message}\n`);
  process.exit(1);
});
