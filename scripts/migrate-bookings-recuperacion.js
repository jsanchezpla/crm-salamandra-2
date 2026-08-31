/**
 * migrate-bookings-recuperacion.js — la falta recuperable apunta a la cita que
 * la recupera (31/08/2026).
 *
 * Una columna opcional en `bookings`: `recovered_by_booking_id`. Hasta hoy
 * «esta falta se recuperó con la cita del jueves» se cuadraba a mano entre
 * compañeras. Sin FK dura a propósito: si la cita que recuperaba se borra,
 * el histórico de la falta no debe reventar.
 *
 * Aditiva e idempotente (ADD COLUMN IF NOT EXISTS). Los schemas los da
 * scripts/_schema-targets.js (fotos doradas incluidas).
 *
 * Uso VPS:  docker cp + docker exec crm-salamandra-app-1 node scripts/migrate-bookings-recuperacion.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

async function main() {
  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  const { schemas, skipped } = await byTable(s, "bookings");
  for (const sinTabla of skipped) process.stdout.write(`  · ${sinTabla} sin tabla bookings, nada que blindar\n`);

  for (const schema of schemas) {
    await s.query(`ALTER TABLE "${schema}"."bookings" ADD COLUMN IF NOT EXISTS "recovered_by_booking_id" UUID`);
    process.stdout.write(`  ✓ ${schema}\n`);
  }
  process.stdout.write(`\n✓ bookings con recovered_by_booking_id en ${schemas.length} esquemas.\n`);
  await s.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
