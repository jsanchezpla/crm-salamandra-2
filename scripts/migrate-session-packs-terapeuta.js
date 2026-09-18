/**
 * migrate-session-packs-terapeuta.js — quién da las sesiones de un bono
 * (`session_packs.team_member_id`, 18/09/2026).
 *
 * AV-0183 de Aumenta, Isabel: «no aparece el terapeuta al que se le asigna». Al
 * dar un bono se elegía paciente, tipo, sesiones, importe y fecha; del equipo,
 * nadie. Y no era que no se enseñara: la tabla no tenía dónde guardarlo, así
 * que Bonos no se podía mirar por profesional y el cobro que nace con el bono
 * no se le imputaba a nadie.
 *
 * NULL = sin asignar, que es lo que se queda todo lo ya dado. **No se rellena
 * hacia atrás**: el terapeuta no se puede deducir de las citas del bono porque
 * 234 de los 243 de Aumenta no tienen ninguna (los bonos se dan por adelantado,
 * antes de la primera sesión), y adivinarlo con los 9 que sí las tienen sería
 * escribir a mano un dato que nadie ha dicho.
 *
 * Solo ESTRUCTURA: una columna a NULL para todo lo que ya existe y su índice.
 * Recorre los schemas con `_schema-targets.js` (`byTable` sobre
 * `session_packs`), fotos doradas incluidas. Idempotente. Correr ANTES de
 * deploy.sh: el modelo la lee.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-session-packs-terapeuta.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-session-packs-terapeuta.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function processSchema(s, schema) {
  await s.query(`ALTER TABLE "${schema}"."session_packs" ADD COLUMN IF NOT EXISTS team_member_id UUID`);
  await s.query(
    `CREATE INDEX IF NOT EXISTS session_packs_team_idx ON "${schema}"."session_packs" (team_member_id)`
  );
  const [col] = await s.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = :schema AND table_name = 'session_packs' AND column_name = 'team_member_id'`,
    { replacements: { schema } }
  );
  if (!col.length) throw new Error(`${schema}: la columna team_member_id NO está`);
  log(`✓ ${schema}: columna team_member_id asegurada`);
}

async function main() {
  process.stdout.write("\n▶ Migración: quién da el bono (session_packs.team_member_id)\n");
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
