/**
 * migrate-booking-change-requests.js — solicitudes de cambio de cita.
 *
 * Crea `booking_change_requests` para cada tenant con tabla `bookings` (módulo
 * citas). Guarda la propuesta que una terapeuta (no-admin) manda al centro; la
 * cita no se toca hasta que el admin la aprueba. Incluye snapshots para render.
 *
 * Aditiva e idempotente (CREATE TABLE/INDEX IF NOT EXISTS). Selecciona schemas
 * por existencia de `bookings` (helper compartido `byTable`, regla #12).
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-booking-change-requests.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-booking-change-requests.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: solicitudes de cambio de cita\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  try { await s.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`); } catch { /* ignorar */ }

  const { schemas } = await byTable(s, "bookings");
  if (schemas.length === 0) log("· Ningún schema con tabla bookings.");

  for (const schema of schemas) {
    try {
      await s.query(
        `CREATE TABLE IF NOT EXISTS "${schema}"."booking_change_requests" (
           id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
           booking_id UUID NOT NULL REFERENCES "${schema}"."bookings"(id) ON DELETE CASCADE,
           proposed_scheduled_at TIMESTAMPTZ NOT NULL,
           proposed_team_member_id UUID,
           proposed_team_member_name VARCHAR(255),
           reason TEXT,
           current_scheduled_at TIMESTAMPTZ,
           subject_name VARCHAR(255),
           event_type_name VARCHAR(255),
           requested_by_user_id UUID,
           requested_by_team_member_id UUID,
           requested_by_name VARCHAR(255),
           status VARCHAR(20) NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending','approved','rejected')),
           resolved_by_user_id UUID,
           resolved_at TIMESTAMPTZ,
           created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
           updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
         )`
      );
      await s.query(
        `CREATE INDEX IF NOT EXISTS "booking_change_requests_status_idx"
           ON "${schema}"."booking_change_requests" (status)`
      );
      await s.query(
        `CREATE INDEX IF NOT EXISTS "booking_change_requests_booking_id_idx"
           ON "${schema}"."booking_change_requests" (booking_id)`
      );
      log(`✓ ${schema}: booking_change_requests listo`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n ✓ Migración completada\n\n");
  await s.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
