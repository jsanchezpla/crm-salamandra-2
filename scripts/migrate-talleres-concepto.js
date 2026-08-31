/**
 * migrate-talleres-concepto.js — el taller apunta a su concepto de cobro
 * (31/08/2026): columna opcional `concept_id` en `talleres`, hacia
 * `billing_concepts` sin FK dura (borrar el concepto no rompe el taller).
 *
 * Aditiva e idempotente. Los schemas los da scripts/_schema-targets.js
 * (fotos doradas incluidas).
 *
 * Uso VPS:  docker cp + docker exec crm-salamandra-app-1 node scripts/migrate-talleres-concepto.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

async function main() {
  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  const { schemas, skipped } = await byTable(s, "talleres");
  for (const sinTabla of skipped) process.stdout.write(`  · ${sinTabla} sin tabla talleres, nada que blindar\n`);

  for (const schema of schemas) {
    await s.query(`ALTER TABLE "${schema}"."talleres" ADD COLUMN IF NOT EXISTS "concept_id" UUID`);
    process.stdout.write(`  ✓ ${schema}\n`);
  }
  process.stdout.write(`\n✓ talleres con concept_id en ${schemas.length} esquemas.\n`);
  await s.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
