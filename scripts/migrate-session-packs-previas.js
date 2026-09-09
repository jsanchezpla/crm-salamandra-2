/**
 * migrate-session-packs-previas.js — las sesiones que un bono ya había gastado
 * antes de llegar al CRM (`session_packs.sesiones_previas`, 09/09/2026).
 *
 * Aumenta: «los bonos abiertos de Organízate no se tienen en cuenta en CRM».
 *
 * ── POR QUÉ HACE FALTA UNA COLUMNA ─────────────────────────────────────────
 * En el CRM las sesiones gastadas NO se guardan: se CUENTAN desde las citas
 * (`lib/citas/packs.js`), y eso es lo correcto mientras el bono haya vivido
 * siempre aquí. Pero los 229 bonos de Organízate se gastaron en citas de 2023,
 * 2024 y 2025, y el CRM solo tiene la agenda de 2026 en adelante: contándolas
 * saldrían TODOS enteros, y un bono agotado en 2024 diría «le quedan 5».
 *
 * Así que la foto de lo ya gastado viaja en el propio bono. Es un sumando, no
 * un contador: nadie lo sube ni lo baja nunca más, y las sesiones que se den
 * de aquí en adelante se siguen contando desde las citas, como siempre.
 *
 * 0 en todo lo que ya existe = ningún bono cambia.
 *
 * Recorre los schemas con `_schema-targets.js` (`byTable` sobre
 * `session_packs`), fotos doradas incluidas. Idempotente. Correr ANTES de
 * deploy.sh: el modelo la lee.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-session-packs-previas.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-session-packs-previas.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function processSchema(s, schema) {
  await s.query(
    `ALTER TABLE "${schema}"."session_packs"
       ADD COLUMN IF NOT EXISTS sesiones_previas INTEGER NOT NULL DEFAULT 0`
  );
  const [col] = await s.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = :schema AND table_name = 'session_packs' AND column_name = 'sesiones_previas'`,
    { replacements: { schema } }
  );
  if (!col.length) throw new Error(`${schema}: la columna sesiones_previas NO está`);
  log(`✓ ${schema}: columna sesiones_previas asegurada`);
}

async function main() {
  process.stdout.write("\n▶ Migración: las sesiones que el bono ya traía gastadas (session_packs.sesiones_previas)\n");
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
