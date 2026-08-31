/**
 * migrate-payments-terapia.js — el cobro aprende de quién y de qué terapia es
 * (31/08/2026).
 *
 * Dos columnas opcionales en `payments`: `patient_id` (el paciente de la
 * cuota) y `concept_id` (el concepto del catálogo, billing_concepts). Son el
 * cimiento de «Facturar el mes» agrupando por terapia: sin ellas el cobro no
 * sabía más que el pagador. Sin FK dura a propósito, como `bank_transaction_id`:
 * las tablas existen en todos los schemas pero el enlace es best-effort y un
 * concepto borrado no debe romper el histórico de cobros.
 *
 * Aditiva e idempotente (ADD COLUMN IF NOT EXISTS, sin valor por defecto).
 * Los schemas los da scripts/_schema-targets.js (fotos doradas incluidas).
 *
 * Uso VPS:  docker cp + docker exec crm-salamandra-app-1 node scripts/migrate-payments-terapia.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

async function main() {
  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  const schemas = await byTable(s, "payments");

  for (const schema of schemas) {
    await s.query(`ALTER TABLE "${schema}"."payments" ADD COLUMN IF NOT EXISTS "patient_id" UUID`);
    await s.query(`ALTER TABLE "${schema}"."payments" ADD COLUMN IF NOT EXISTS "concept_id" UUID`);
    process.stdout.write(`  ✓ ${schema}\n`);
  }
  process.stdout.write(`\n✓ payments con patient_id y concept_id en ${schemas.length} esquemas.\n`);
  await s.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
