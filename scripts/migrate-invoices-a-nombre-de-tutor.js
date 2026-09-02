/**
 * migrate-invoices-a-nombre-de-tutor.js — una factura puede ir a nombre de un
 * TUTOR de la familia (02/09/2026, decisión de Rodrigo).
 *
 * Una columna opcional en `invoices`: `guardian_id` (UUID), el `id` de la
 * entrada de `clients.guardians` a cuyo nombre se emite. El pagador sigue
 * siendo `client_id` (la familia): la factura cuelga de su ficha, sus cobros
 * y su morosidad; lo que cambia es a QUIÉN se le emite —nombre y DNI del
 * tutor, congelados en `fiscal_snapshot` al emitir—. Sin FK dura a propósito:
 * el tutor vive dentro de un JSONB y borrarlo de la ficha no debe romper una
 * factura ya emitida (que ya lleva su foto).
 *
 * Aditiva e idempotente (ADD COLUMN IF NOT EXISTS, sin valor por defecto).
 * Los schemas los da scripts/_schema-targets.js (fotos doradas incluidas).
 * Va ANTES del despliegue: el modelo pide la columna por nombre.
 *
 * Uso VPS:  docker cp + docker exec crm-salamandra-app-1 node scripts/migrate-invoices-a-nombre-de-tutor.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

async function main() {
  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  const { schemas, skipped } = await byTable(s, "invoices");
  for (const sinTabla of skipped) process.stdout.write(`  · ${sinTabla} sin tabla invoices, nada que hacer\n`);

  for (const schema of schemas) {
    await s.query(`ALTER TABLE "${schema}"."invoices" ADD COLUMN IF NOT EXISTS "guardian_id" UUID`);
    process.stdout.write(`  ✓ ${schema}\n`);
  }
  process.stdout.write(`\n✓ invoices con guardian_id en ${schemas.length} esquemas.\n`);
  await s.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
