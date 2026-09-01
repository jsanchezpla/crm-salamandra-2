/**
 * migrate-clients-cuota.js — la ficha recuerda de qué se compone su cuota
 * (31/08/2026).
 *
 * Una columna opcional en `clients`: `cuota_concept_ids` (JSONB, ids de
 * billing_concepts). Es lo que hace que al elegir a la familia en «Nuevo
 * cobro» se rellene SU cuota sola. Sin FK dura a propósito: el enlace es
 * best-effort y un concepto borrado no debe romper la ficha.
 *
 * Aditiva e idempotente (ADD COLUMN IF NOT EXISTS, sin valor por defecto).
 * Los schemas los da scripts/_schema-targets.js (fotos doradas incluidas).
 *
 * Uso VPS:  docker cp + docker exec crm-salamandra-app-1 node scripts/migrate-clients-cuota.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

async function main() {
  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  const { schemas, skipped } = await byTable(s, "clients");
  for (const sinTabla of skipped) process.stdout.write(`  · ${sinTabla} sin tabla clients, nada que hacer\n`);

  for (const schema of schemas) {
    await s.query(`ALTER TABLE "${schema}"."clients" ADD COLUMN IF NOT EXISTS "cuota_concept_ids" JSONB`);
    process.stdout.write(`  ✓ ${schema}\n`);
  }
  process.stdout.write(`\n✓ clients con cuota_concept_ids en ${schemas.length} esquemas.\n`);
  await s.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
